function getSupabaseUrl() {
  return process.env.SUPABASE_URL || "";
}

function getSupabaseServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function getSupabaseHeaders(extra = {}) {
  return {
    apikey: getSupabaseServiceKey(),
    Authorization: `Bearer ${getSupabaseServiceKey()}`,
    ...extra,
  };
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseServiceKey());
}

async function supabaseRequest(path, { method = "GET", body, headers = {} } = {}) {
  if (!isSupabaseConfigured()) return null;

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/${path}`, {
    method,
    headers: getSupabaseHeaders({ "Content-Type": "application/json", Prefer: "return=representation", ...headers }),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    return null;
  }

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchActiveRuleMetadata(country, system) {
  if (!country || !system) return null;

  const encodedCountry = encodeURIComponent(country);
  const encodedSystem = encodeURIComponent(system);

  const path = `immigration_rules?country=eq.${encodedCountry}&program=eq.${encodedSystem}&active=eq.true&select=rule_version,last_verified_at,source_urls,updated_at&order=updated_at.desc&limit=1`;
  const rows = await supabaseRequest(path);

  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];

  return {
    ruleVersion: row.rule_version || null,
    lastVerifiedAt: row.last_verified_at || row.updated_at || null,
    sourceUrls: Array.isArray(row.source_urls) ? row.source_urls : [],
  };
}

export async function matchEvidenceChunks({ embedding, matchCount = 5, country = null, program = null }) {
  if (!Array.isArray(embedding) || embedding.length === 0) return [];
  if (!isSupabaseConfigured()) return [];

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/rpc/match_evidence_chunks`, {
    method: "POST",
    headers: getSupabaseHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      query_embedding: embedding,
      match_count: matchCount,
      filter_country: country,
      filter_program: program,
    }),
  });

  if (!response.ok) return [];

  try {
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function upsertCrawlSource({ country, program, sourceUrl }) {
  if (!country || !program || !sourceUrl) return null;

  const path = "crawl_sources?on_conflict=source_url";
  const rows = await supabaseRequest(path, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: [{ country, program, source_url: sourceUrl, status: "active", updated_at: new Date().toISOString() }],
  });

  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function updateCrawlSourceTimestamp(sourceId) {
  if (!sourceId) return null;
  return supabaseRequest(`crawl_sources?id=eq.${sourceId}`, {
    method: "PATCH",
    body: { last_crawled_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  });
}

export async function insertCrawlSnapshot(snapshot) {
  const rows = await supabaseRequest("crawl_snapshots", {
    method: "POST",
    body: [snapshot],
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function findCrawlSnapshotByHash({ sourceId, contentHash }) {
  if (!sourceId || !contentHash) return null;

  const path = `crawl_snapshots?source_id=eq.${sourceId}&content_hash=eq.${contentHash}&select=id,storage_path,content_hash,captured_at&limit=1`;
  const rows = await supabaseRequest(path);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function insertImmigrationRule(rule) {
  const rows = await supabaseRequest("immigration_rules", {
    method: "POST",
    body: [rule],
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function insertEvidenceChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const rows = await supabaseRequest("evidence_chunks", {
    method: "POST",
    body: chunks,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function uploadSnapshotToStorage({ bucket, objectPath, content, contentType = "text/html; charset=utf-8" }) {
  if (!bucket || !objectPath || typeof content !== "string") return false;
  if (!isSupabaseConfigured()) return false;

  const response = await fetch(`${getSupabaseUrl()}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: getSupabaseHeaders({ "Content-Type": contentType, "x-upsert": "true" }),
    body: content,
  });

  return response.ok;
}
