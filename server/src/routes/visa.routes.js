import { Router } from "express";
import PDFDocument from "pdfkit";
import { requireAuth } from "../middleware/auth.js";
import { Profile } from "../models/Profile.js";
import { QueryHistory } from "../models/QueryHistory.js";
import { SavedVisaOption } from "../models/SavedVisaOption.js";
import { runLLM } from "../lib/llm.js";
import { calculateOfficialStyleScore } from "../services/pointsScoring.js";
import { runCanadaCrawlerJob } from "../services/crawler.js";

const router = Router();
const RECOMMENDATION_CACHE_TTL_MS = Number(process.env.RECOMMENDATION_CACHE_TTL_MS || 10 * 60 * 1000);
const recommendationCache = new Map();

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function makeRecommendationCacheKey(profile) {
  return stableStringify(profile || {});
}

function getCachedRecommendations(cacheKey) {
  const entry = recommendationCache.get(cacheKey);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    recommendationCache.delete(cacheKey);
    return null;
  }

  return entry;
}

function putCachedRecommendations(cacheKey, value) {
  recommendationCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + RECOMMENDATION_CACHE_TTL_MS,
  });
}

function safeJsonParse(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeConfidence(value) {
  const c = String(value || "").toLowerCase();
  if (["low", "medium", "high"].includes(c)) return c;
  return "medium";
}

function normalizeCitations(citations) {
  if (!Array.isArray(citations)) return [];
  return citations
    .map((c) => ({
      label: String(c?.label || "Official source"),
      url: String(c?.url || "").trim(),
      publisher: c?.publisher ? String(c.publisher) : undefined,
      retrievedAt: c?.retrievedAt ? String(c.retrievedAt) : undefined,
    }))
    .filter((c) => c.url.startsWith("http://") || c.url.startsWith("https://"));
}

function normalizeRecommendations(recommendations) {
  if (!Array.isArray(recommendations)) return [];

  return recommendations.slice(0, 3).map((r, i) => ({
    code: String(r?.code || `LLM-${i + 1}`),
    title: String(r?.title || `Recommendation ${i + 1}`),
    processingMonths: String(r?.processingMonths || "Varies"),
    eligibilityScore: Math.max(0, Math.min(100, Number(r?.eligibilityScore || 0))),
    confidence: normalizeConfidence(r?.confidence),
    reasoning: Array.isArray(r?.reasoning) ? r.reasoning.map((x) => String(x)) : [],
    docTemplate: Array.isArray(r?.docTemplate) ? r.docTemplate.map((x) => String(x)) : [],
    lastVerifiedAt: r?.lastVerifiedAt ? String(r.lastVerifiedAt) : null,
    sourceCitations: normalizeCitations(r?.sourceCitations),
  }));
}

async function generateRecommendationsFromLLM(profile) {
  const cacheKey = makeRecommendationCacheKey(profile);
  const cached = getCachedRecommendations(cacheKey);
  if (cached?.value) return cached.value;
  if (cached?.pending) return cached.pending;

  const fallback = {
    summary:
      "I couldn't generate recommendations right now. Please verify requirements on official immigration websites. This is not legal advice.",
    recommendations: [],
  };

  const systemPrompt =
    "You are a migration assistant. Return STRICT JSON only (no markdown). Include only realistic visa pathways for the destination country. Every recommendation MUST include sourceCitations with official URLs. Always include uncertainty and avoid guarantees. Output schema: {\"summary\": string, \"recommendations\": [{\"code\": string, \"title\": string, \"processingMonths\": string, \"eligibilityScore\": number, \"confidence\": \"low\"|\"medium\"|\"high\", \"reasoning\": string[], \"docTemplate\": string[], \"lastVerifiedAt\": string, \"sourceCitations\": [{\"label\": string, \"url\": string, \"publisher\": string, \"retrievedAt\": string}]}]}. End summary with: This is not legal advice.";

  const pending = (async () => {
    const firstText = await runLLM({
      system: systemPrompt,
      user: `Generate top 3 visa recommendations for this profile: ${JSON.stringify(profile)}`,
      fallback: JSON.stringify(fallback),
    });

    const firstParsed = safeJsonParse(firstText) || fallback;
    let normalized = normalizeRecommendations(firstParsed?.recommendations);
    let summary = String(firstParsed?.summary || fallback.summary);

    // Retry once if model returned invalid structure or empty recommendation list.
    if (normalized.length === 0) {
      const retryText = await runLLM({
        system: systemPrompt,
        user:
          `Your previous answer was not usable. Return valid JSON with at least 2 recommendations and official citations. ` +
          `Profile: ${JSON.stringify(profile)}. ` +
          `Destination country is ${profile?.destinationCountry || "unknown"}.`,
        fallback: JSON.stringify(fallback),
      });

      const retryParsed = safeJsonParse(retryText) || fallback;
      normalized = normalizeRecommendations(retryParsed?.recommendations);
      summary = String(retryParsed?.summary || summary);
    }

    return {
      summary: summary.includes("This is not legal advice.") ? summary : `${summary} This is not legal advice.`,
      recommendations: normalized,
    };
  })();

  recommendationCache.set(cacheKey, {
    pending,
    expiresAt: Date.now() + RECOMMENDATION_CACHE_TTL_MS,
  });

  try {
    const result = await pending;
    putCachedRecommendations(cacheKey, result);
    return result;
  } catch (error) {
    recommendationCache.delete(cacheKey);
    throw error;
  }
}

function generateChecklist(visaOption) {
  return {
    checklist: visaOption.docTemplate || [],
    sourceCitations: visaOption.sourceCitations || [],
    lastVerifiedAt: visaOption.lastVerifiedAt || null,
  };
}

router.post("/analyze", requireAuth, async (req, res) => {
  const payload = req.body;
  const officialScorePromise = calculateOfficialStyleScore(payload);
  const [profile, { summary: llmSummary, recommendations }] = await Promise.all([
    Profile.create({ userId: req.user.sub, ...payload }),
    generateRecommendationsFromLLM(payload),
  ]);
  const officialScore = await officialScorePromise;

  QueryHistory.create({
    userId: req.user.sub,
    profileId: profile._id,
    type: "analysis",
    prompt: JSON.stringify(payload),
    response: llmSummary,
    confidence: recommendations[0]?.confidence || "low",
  }).catch(() => {
    // Non-blocking write; analysis response should not fail if history logging fails.
  });

  res.json({
    profileId: profile._id,
    officialScore,
    recommendations,
    summary: llmSummary,
    disclaimer: "This is not legal advice.",
  });
});

router.post("/score", requireAuth, async (req, res) => {
  const payload = req.body || {};
  const officialScore = await calculateOfficialStyleScore(payload);
  res.json({ officialScore });
});

router.post("/crawl/canada", requireAuth, async (_req, res) => {
  const result = await runCanadaCrawlerJob();
  res.json({
    ok: result.failed === 0,
    job: result,
  });
});

router.get("/checklist/:profileId/:visaCode", requireAuth, async (req, res) => {
  const profile = await Profile.findOne({ _id: req.params.profileId, userId: req.user.sub });
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  const { recommendations } = await generateRecommendationsFromLLM(profile.toObject());
  const selected = recommendations.find((r) => r.code === req.params.visaCode);
  if (!selected) return res.status(404).json({ error: "Visa option not found" });

  const checklistResult = generateChecklist(selected);
  res.json({
    checklist: checklistResult.checklist,
    processingTime: selected.processingMonths,
    sourceCitations: checklistResult.sourceCitations,
    lastVerifiedAt: checklistResult.lastVerifiedAt,
  });
});

router.post("/save-option", requireAuth, async (req, res) => {
  const { profileId, visaCode, title, destinationCountry, notes } = req.body;
  const doc = await SavedVisaOption.create({
    userId: req.user.sub,
    profileId,
    visaCode,
    title,
    destinationCountry,
    notes,
  });
  res.json(doc);
});

router.get("/saved-options", requireAuth, async (req, res) => {
  const options = await SavedVisaOption.find({ userId: req.user.sub }).sort({ createdAt: -1 });
  res.json(options);
});

router.get("/export/:profileId", requireAuth, async (req, res) => {
  const profile = await Profile.findOne({ _id: req.params.profileId, userId: req.user.sub });
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const { recommendations } = await generateRecommendationsFromLLM(profile.toObject());

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=visa-report.pdf");

  const doc = new PDFDocument();
  doc.pipe(res);
  doc.fontSize(18).text("Migration & Visa Assistant Report");
  doc.moveDown();
  doc.fontSize(12).text(`Destination: ${profile.destinationCountry}`);
  doc.text(`Purpose: ${profile.purpose}`);
  doc.text("Disclaimer: This is not legal advice.");
  doc.moveDown();
  recommendations.forEach((r, i) => {
    doc.fontSize(13).text(`${i + 1}. ${r.title} (${r.code})`);
    doc.fontSize(11).text(`Eligibility Score: ${r.eligibilityScore} | Confidence: ${r.confidence}`);
    doc.text(`Processing: ${r.processingMonths}`);
    doc.text(`Reasoning: ${r.reasoning.join(" ")}`);
    if (r.lastVerifiedAt) {
      doc.text(`Last verified: ${r.lastVerifiedAt}`);
    }
    if (r.sourceCitations?.length) {
      doc.text("Sources:");
      r.sourceCitations.forEach((s) => {
        doc.text(`- ${s.label}: ${s.url}`);
      });
    }
    doc.moveDown();
  });
  doc.end();
});

export default router;
