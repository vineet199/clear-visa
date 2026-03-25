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

function confidenceFromScore(score) {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function normalizePurpose(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDestination(value) {
  return String(value || "").trim().toLowerCase();
}

function buildRuleBasedScore(profile, weightBoost = 0) {
  let score = 35 + weightBoost;

  const yearsExperience = Number(profile?.yearsExperience || 0);
  const budgetUsd = Number(profile?.budgetUsd || 0);
  const englishLevel = String(profile?.englishLevel || "").toLowerCase();
  const educationLevel = String(profile?.educationLevel || "").toLowerCase();

  if (yearsExperience >= 2) score += 15;
  if (yearsExperience >= 4) score += 10;
  if (budgetUsd >= 12000) score += 12;
  if (budgetUsd >= 20000) score += 8;
  if (["b2", "c1", "c2"].includes(englishLevel)) score += 10;
  if (["bachelor", "master", "phd"].includes(educationLevel)) score += 10;

  return Math.max(20, Math.min(95, score));
}

function makeRecommendation({ code, title, processingMonths, reasons, docs, citations, score }) {
  const eligibilityScore = Math.max(0, Math.min(100, Number(score || 0)));

  return {
    code,
    title,
    processingMonths,
    eligibilityScore,
    confidence: confidenceFromScore(eligibilityScore),
    reasoning: reasons,
    docTemplate: docs,
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
    sourceCitations: citations,
  };
}

function buildFallbackRecommendations(profile) {
  const destination = normalizeDestination(profile?.destinationCountry);
  const purpose = normalizePurpose(profile?.purpose);

  const canadaCitations = [
    { label: "IRCC Immigration and citizenship", url: "https://www.canada.ca/en/services/immigration-citizenship.html", publisher: "Government of Canada" },
    { label: "IRCC Express Entry", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html", publisher: "Government of Canada" },
    { label: "IRCC Work permits", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada.html", publisher: "Government of Canada" },
  ];

  const genericCitations = [
    { label: "Official destination immigration portal", url: "https://www.canada.ca/en/services/immigration-citizenship.html", publisher: "Government source" },
  ];

  const baseScore = buildRuleBasedScore(profile);

  if (destination === "canada") {
    if (purpose === "work") {
      return [
        makeRecommendation({
          code: "CA-EXPRESS-ENTRY",
          title: "Canada Express Entry (Skilled Worker pathways)",
          processingMonths: "6-12 months (varies by stream and draw)",
          score: baseScore + 8,
          reasons: [
            "Work purpose aligns with skilled immigration pathways.",
            "Profile indicates baseline suitability for points-based assessment.",
            "Strong English and education can improve ranking competitiveness.",
          ],
          docs: [
            "Valid passport",
            "Educational credential assessment (ECA)",
            "Language test results (IELTS/CELPIP)",
            "Proof of work experience",
            "Police clearance certificates",
          ],
          citations: canadaCitations,
        }),
        makeRecommendation({
          code: "CA-PNP",
          title: "Provincial Nominee Program (PNP)",
          processingMonths: "8-18 months (varies by province)",
          score: baseScore + 4,
          reasons: [
            "PNP can complement Express Entry for occupation-targeted invites.",
            "Destination and work intent may fit province-specific labor needs.",
          ],
          docs: [
            "Passport and identity documents",
            "Work references",
            "Province-specific forms",
            "Language test proof",
            "Settlement funds evidence",
          ],
          citations: canadaCitations,
        }),
        makeRecommendation({
          code: "CA-EMPLOYER-WP",
          title: "Employer-supported Work Permit",
          processingMonths: "2-8 months (varies by case)",
          score: baseScore,
          reasons: [
            "Work permit route may be practical if employer sponsorship is available.",
            "Can be a bridge toward permanent residency options later.",
          ],
          docs: [
            "Job offer / employment contract",
            "LMIA or exemption evidence (if applicable)",
            "Passport",
            "Work history documents",
            "Medical exam (if required)",
          ],
          citations: canadaCitations,
        }),
      ];
    }

    if (purpose === "study") {
      return [
        makeRecommendation({
          code: "CA-STUDY-PERMIT",
          title: "Canada Study Permit",
          processingMonths: "4-12 weeks (varies by region)",
          score: baseScore + 5,
          reasons: [
            "Study purpose aligns directly with permit category.",
            "Budget appears relevant for tuition and settlement planning.",
          ],
          docs: [
            "Letter of acceptance from DLI",
            "Proof of funds",
            "Passport",
            "Statement of purpose",
            "Academic transcripts",
          ],
          citations: canadaCitations,
        }),
      ];
    }
  }

  return [
    makeRecommendation({
      code: "GEN-PRIMARY",
      title: `${profile?.destinationCountry || "Destination"} primary immigration pathway review`,
      processingMonths: "Varies",
      score: baseScore,
      reasons: [
        "A precise pathway could not be determined from dynamic recommendation generation.",
        "Use official immigration portals for current stream-specific criteria.",
      ],
      docs: ["Passport", "Identity proof", "Financial evidence", "Purpose-specific supporting documents"],
      citations: genericCitations,
    }),
    makeRecommendation({
      code: "GEN-WORK-AUTH",
      title: "Work authorization route assessment",
      processingMonths: "Varies",
      score: Math.max(35, baseScore - 5),
      reasons: [
        "Employment-focused pathways often require sponsorship or labor-market alignment.",
        "Skill, language, and experience profile should be validated against official rules.",
      ],
      docs: ["Work references", "Language score", "Educational proof", "Offer letter (if available)"],
      citations: genericCitations,
    }),
  ];
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

    const fallbackRecommendations = normalized.length > 0 ? normalized : buildFallbackRecommendations(profile);

    return {
      summary: summary.includes("This is not legal advice.") ? summary : `${summary} This is not legal advice.`,
      recommendations: fallbackRecommendations,
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
