import { fetchActiveRuleMetadata } from "../lib/supabase.js";

function normalizeCountry(value) {
  return String(value || "").trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreCanadaExpressEntry(profile) {
  const age = toNumber(profile.age);
  const yearsExperience = toNumber(profile.yearsExperience);
  const englishLevel = String(profile.englishLevel || "").toLowerCase();
  const educationLevel = String(profile.educationLevel || "").toLowerCase();
  const hasJobOffer = Boolean(profile.hasJobOffer);
  const hasProvincialNomination = Boolean(profile.hasProvincialNomination);

  const breakdown = [];
  let score = 0;

  const agePoints = age >= 20 && age <= 29 ? 110 : age >= 30 && age <= 35 ? 80 : age >= 36 && age <= 44 ? 50 : 20;
  score += agePoints;
  breakdown.push({ label: "Age", points: agePoints, maxPoints: 110, note: "Approximation of CRS-like age contribution." });

  const educationPoints = {
    phd: 150,
    master: 135,
    bachelor: 120,
    diploma: 90,
    "high school": 40,
  }[educationLevel] || 0;
  score += educationPoints;
  breakdown.push({ label: "Education", points: educationPoints, maxPoints: 150 });

  const languagePoints = {
    c2: 140,
    c1: 130,
    b2: 95,
    b1: 65,
    a2: 25,
    a1: 10,
  }[englishLevel] || 0;
  score += languagePoints;
  breakdown.push({ label: "Language (English)", points: languagePoints, maxPoints: 140 });

  const experiencePoints = yearsExperience >= 6 ? 80 : yearsExperience >= 4 ? 65 : yearsExperience >= 2 ? 45 : yearsExperience >= 1 ? 25 : 0;
  score += experiencePoints;
  breakdown.push({ label: "Work experience", points: experiencePoints, maxPoints: 80 });

  const jobOfferPoints = hasJobOffer ? 50 : 0;
  score += jobOfferPoints;
  breakdown.push({ label: "Valid job offer", points: jobOfferPoints, maxPoints: 50 });

  const nominationPoints = hasProvincialNomination ? 600 : 0;
  score += nominationPoints;
  breakdown.push({ label: "Provincial nomination", points: nominationPoints, maxPoints: 600 });

  return {
    country: "Canada",
    system: "Express Entry style (CRS-like estimator)",
    frameworkVersion: "canada-ee-v1",
    lastUpdated: "2026-03-19",
    maxScore: 1200,
    score: Math.max(0, Math.min(1200, score)),
    thresholds: [
      { label: "Competitive", min: 500 },
      { label: "Borderline", min: 430 },
      { label: "Low", min: 0 },
    ],
    requiredFields: ["age", "educationLevel", "englishLevel", "yearsExperience"],
    breakdown,
  };
}

function scoreAustraliaSkilled(profile) {
  const age = toNumber(profile.age);
  const yearsExperience = toNumber(profile.yearsExperience);
  const englishLevel = String(profile.englishLevel || "").toLowerCase();
  const educationLevel = String(profile.educationLevel || "").toLowerCase();
  const hasStateNomination = Boolean(profile.hasProvincialNomination);

  let score = 0;
  const breakdown = [];

  const agePoints = age >= 25 && age <= 32 ? 30 : age >= 18 && age <= 24 ? 25 : age >= 33 && age <= 39 ? 25 : age >= 40 && age <= 44 ? 15 : 0;
  score += agePoints;
  breakdown.push({ label: "Age", points: agePoints, maxPoints: 30 });

  const englishPoints = englishLevel === "c2" ? 20 : englishLevel === "c1" ? 10 : englishLevel === "b2" ? 0 : 0;
  score += englishPoints;
  breakdown.push({ label: "English language", points: englishPoints, maxPoints: 20 });

  const expPoints = yearsExperience >= 8 ? 15 : yearsExperience >= 5 ? 10 : yearsExperience >= 3 ? 5 : 0;
  score += expPoints;
  breakdown.push({ label: "Skilled employment", points: expPoints, maxPoints: 15 });

  const eduPoints = educationLevel === "phd" ? 20 : educationLevel === "master" || educationLevel === "bachelor" ? 15 : educationLevel === "diploma" ? 10 : 0;
  score += eduPoints;
  breakdown.push({ label: "Educational qualification", points: eduPoints, maxPoints: 20 });

  const nominationPoints = hasStateNomination ? 5 : 0;
  score += nominationPoints;
  breakdown.push({ label: "State/Territory nomination", points: nominationPoints, maxPoints: 5 });

  return {
    country: "Australia",
    system: "Skilled migration points test estimator",
    frameworkVersion: "australia-skilled-v1",
    lastUpdated: "2026-03-19",
    maxScore: 100,
    score: Math.max(0, Math.min(100, score)),
    thresholds: [
      { label: "Likely eligible baseline", min: 65 },
      { label: "Near threshold", min: 55 },
      { label: "Low", min: 0 },
    ],
    requiredFields: ["age", "educationLevel", "englishLevel", "yearsExperience"],
    breakdown,
  };
}

function scoreUkSkilledWorker(profile) {
  const englishLevel = String(profile.englishLevel || "").toLowerCase();
  const hasJobOffer = Boolean(profile.hasJobOffer);
  const salaryGbp = toNumber(profile.salaryGbp);
  const educationLevel = String(profile.educationLevel || "").toLowerCase();

  let score = 0;
  const breakdown = [];

  const jobOfferPoints = hasJobOffer ? 20 : 0;
  score += jobOfferPoints;
  breakdown.push({ label: "Job offer from approved sponsor", points: jobOfferPoints, maxPoints: 20 });

  const englishPoints = ["b2", "c1", "c2"].includes(englishLevel) ? 10 : 0;
  score += englishPoints;
  breakdown.push({ label: "English requirement", points: englishPoints, maxPoints: 10 });

  const salaryPoints = salaryGbp >= 38700 ? 20 : salaryGbp >= 30960 ? 10 : 0;
  score += salaryPoints;
  breakdown.push({ label: "Salary threshold", points: salaryPoints, maxPoints: 20 });

  const qualificationPoints = educationLevel === "phd" ? 10 : educationLevel === "master" ? 5 : 0;
  score += qualificationPoints;
  breakdown.push({ label: "Relevant qualification bonus", points: qualificationPoints, maxPoints: 10 });

  return {
    country: "United Kingdom",
    system: "Skilled Worker tradable-points style estimator",
    frameworkVersion: "uk-skilled-worker-v1",
    lastUpdated: "2026-03-19",
    maxScore: 70,
    score: Math.max(0, Math.min(70, score)),
    thresholds: [
      { label: "Likely eligible baseline", min: 50 },
      { label: "Below threshold", min: 0 },
    ],
    requiredFields: ["hasJobOffer", "englishLevel", "salaryGbp"],
    breakdown,
  };
}

async function addDerivedFields(result, profile) {
  const missingRequiredFields = (result.requiredFields || []).filter((field) => {
    const value = profile?.[field];
    return value === undefined || value === null || value === "";
  });

  const band = (result.thresholds || []).find((t) => result.score >= t.min)?.label || "Low";
  const metadata = await fetchActiveRuleMetadata(result.country, result.system);

  return {
    ...result,
    rulesSourceVersion: metadata?.ruleVersion || result.frameworkVersion,
    sourceCitations: metadata?.sourceUrls || [],
    lastVerifiedAt: metadata?.lastVerifiedAt || result.lastUpdated,
    band,
    missingRequiredFields,
    disclaimer:
      "Official-style estimator only. Rules and cutoffs change often; verify with official immigration sources. This is not legal advice.",
  };
}

export async function calculateOfficialStyleScore(profile) {
  const country = normalizeCountry(profile?.destinationCountry);

  if (country === "canada") return addDerivedFields(scoreCanadaExpressEntry(profile), profile);
  if (country === "australia") return addDerivedFields(scoreAustraliaSkilled(profile), profile);
  if (country === "united kingdom" || country === "uk") return addDerivedFields(scoreUkSkilledWorker(profile), profile);

  return {
    country: profile?.destinationCountry || "Unknown",
    supported: false,
    system: "No standardized points model configured",
    frameworkVersion: "unsupported-v1",
    lastUpdated: "2026-03-19",
    score: null,
    maxScore: null,
    band: "Not available",
    thresholds: [],
    requiredFields: [],
    missingRequiredFields: [],
    breakdown: [],
    disclaimer:
      "A universal official points score is not available for this destination in the current app module. This is not legal advice.",
  };
}
