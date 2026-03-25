import { createHash } from "node:crypto";
import {
  findCrawlSnapshotByHash,
  insertCrawlSnapshot,
  insertEvidenceChunks,
  insertImmigrationRule,
  updateCrawlSourceTimestamp,
  uploadSnapshotToStorage,
  upsertCrawlSource,
} from "../lib/supabase.js";
import { generateEmbedding } from "../lib/llm.js";

const DEFAULT_CANADA_SOURCES = [
  {
    country: "Canada",
    program: "Express Entry style (CRS-like estimator)",
    sourceUrl:
      "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/check-score.html",
  },
  {
    country: "Canada",
    program: "Express Entry style (CRS-like estimator)",
    sourceUrl:
      "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/eligibility/federal-skilled-workers.html",
  },
];

let crawlerIntervalHandle = null;

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoChunks(text, maxLen = 1200) {
  const clean = String(text || "").trim();
  if (!clean) return [];

  const chunks = [];
  for (let i = 0; i < clean.length; i += maxLen) {
    chunks.push(clean.slice(i, i + maxLen));
  }
  return chunks;
}

function pickTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (match?.[1] || "Immigration guidance").replace(/\s+/g, " ").trim();
}

async function fetchHtml(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "clear-visa-crawler/1.0 (+https://example.com)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function getOrigin(sourceUrl) {
  return new URL(sourceUrl).origin;
}

function getPathname(sourceUrl) {
  return new URL(sourceUrl).pathname || "/";
}

async function isAllowedByRobots(sourceUrl) {
  try {
    const robotsUrl = `${getOrigin(sourceUrl)}/robots.txt`;
    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": "clear-visa-crawler/1.0 (+https://example.com)" },
    });

    if (!response.ok) return true;
    const txt = (await response.text()).toLowerCase();
    const path = getPathname(sourceUrl).toLowerCase();

    // Basic allowlist check: block when there's a wildcard disallow that matches path.
    const lines = txt.split(/\r?\n/).map((l) => l.trim());
    const disallowed = lines
      .filter((l) => l.startsWith("disallow:"))
      .map((l) => l.replace("disallow:", "").trim())
      .filter(Boolean);

    for (const rule of disallowed) {
      if (rule === "/") return false;
      if (path.startsWith(rule)) return false;
    }

    return true;
  } catch {
    // Fail-open for transient robots fetch issues; source allowlist still limits scope.
    return true;
  }
}

function toVectorLiteral(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  return `[${embedding.join(",")}]`;
}

async function generateChunkEmbedding(chunk) {
  if (process.env.CRAWLER_EMBEDDINGS_ENABLED !== "true") return null;
  return generateEmbedding(chunk);
}

export async function runCanadaCrawlerJob() {
  const bucket = process.env.SUPABASE_SNAPSHOT_BUCKET || "ircc-raw";
  const nowIso = new Date().toISOString();
  const result = {
    startedAt: nowIso,
    processed: 0,
    succeeded: 0,
    failed: 0,
    details: [],
  };

  for (const source of DEFAULT_CANADA_SOURCES) {
    result.processed += 1;

    try {
      const allowedByRobots = await isAllowedByRobots(source.sourceUrl);
      if (!allowedByRobots) {
        throw new Error("Blocked by robots.txt policy");
      }

      const crawlSource = await upsertCrawlSource(source);
      if (!crawlSource?.id) {
        throw new Error("Failed to upsert crawl source");
      }

      const html = await fetchHtml(source.sourceUrl);
      const contentHash = createHash("sha256").update(html).digest("hex");
      const existingSnapshot = await findCrawlSnapshotByHash({ sourceId: crawlSource.id, contentHash });

      if (existingSnapshot?.id) {
        await updateCrawlSourceTimestamp(crawlSource.id);
        result.succeeded += 1;
        result.details.push({
          sourceUrl: source.sourceUrl,
          status: "skipped",
          reason: "content hash already exists",
          contentHash,
        });
        continue;
      }

      const objectPath = `canada/${contentHash}.html`;

      const uploaded = await uploadSnapshotToStorage({
        bucket,
        objectPath,
        content: html,
        contentType: "text/html; charset=utf-8",
      });

      if (!uploaded) {
        throw new Error("Failed to upload snapshot to Supabase storage");
      }

      await insertCrawlSnapshot({
        source_id: crawlSource.id,
        storage_path: `${bucket}/${objectPath}`,
        content_hash: contentHash,
        parser_version: "canada-basic-v1",
      });

      const plainText = stripHtml(html);
      const title = pickTitle(html);

      await insertImmigrationRule({
        country: source.country,
        program: source.program,
        rule_version: `auto-${contentHash.slice(0, 12)}`,
        rule_json: {
          title,
          summary: plainText.slice(0, 1500),
          sourceUrl: source.sourceUrl,
          ingestionType: "basic-crawler",
        },
        source_urls: [source.sourceUrl],
        effective_date: null,
        last_verified_at: nowIso,
        active: true,
      });

      const chunks = splitIntoChunks(plainText, 1200).slice(0, 12);
      const chunkRows = [];
      for (let idx = 0; idx < chunks.length; idx += 1) {
        const chunk = chunks[idx];
        const embedding = await generateChunkEmbedding(chunk);
        chunkRows.push({
          source_id: crawlSource.id,
          country: source.country,
          program: source.program,
          chunk_text: chunk,
          embedding: toVectorLiteral(embedding),
          metadata: {
            sourceUrl: source.sourceUrl,
            title,
            chunkIndex: idx,
            capturedAt: nowIso,
            embeddingGenerated: Boolean(embedding),
          },
        });
      }
      await insertEvidenceChunks(chunkRows);

      await updateCrawlSourceTimestamp(crawlSource.id);

      result.succeeded += 1;
      result.details.push({ sourceUrl: source.sourceUrl, status: "ok", contentHash });
    } catch (error) {
      result.failed += 1;
      result.details.push({
        sourceUrl: source.sourceUrl,
        status: "error",
        message: error?.message || "Unknown error",
      });
    }
  }

  return {
    ...result,
    finishedAt: new Date().toISOString(),
  };
}

export function startCrawlerScheduler() {
  if (process.env.CRAWLER_SCHEDULER_ENABLED !== "true") return;
  if (crawlerIntervalHandle) return;

  const intervalMs = Math.max(60_000, Number(process.env.CRAWLER_INTERVAL_MS || 6 * 60 * 60 * 1000));
  crawlerIntervalHandle = setInterval(() => {
    runCanadaCrawlerJob().catch(() => {
      // Avoid crashing process on scheduler errors.
    });
  }, intervalMs);
}

export function stopCrawlerScheduler() {
  if (!crawlerIntervalHandle) return;
  clearInterval(crawlerIntervalHandle);
  crawlerIntervalHandle = null;
}

export function isCrawlerSchedulerRunning() {
  return Boolean(crawlerIntervalHandle);
}
