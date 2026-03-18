function confidenceFromScore(score) {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function computeEligibility(profile, visa) {
  let score = 0;
  const reasons = [];

  if (visa.purposes.includes((profile.purpose || "").toLowerCase())) {
    score += 25;
    reasons.push("Purpose aligns with visa category.");
  }

  if ((profile.yearsExperience || 0) >= (visa.minExperienceYears || 0)) {
    score += 25;
    reasons.push("Experience meets baseline requirement.");
  } else {
    reasons.push("Experience may be below preferred threshold.");
  }

  if ((profile.budgetUsd || 0) >= (visa.minBudgetUsd || 0)) {
    score += 25;
    reasons.push("Budget appears sufficient for initial pathway costs.");
  } else {
    reasons.push("Budget may be insufficient for this pathway.");
  }

  if (["bachelor", "master", "phd"].includes((profile.educationLevel || "").toLowerCase())) {
    score += 15;
    reasons.push("Education profile supports points-based pathways.");
  }

  if (["b2", "c1", "c2"].includes((profile.englishLevel || "").toLowerCase())) {
    score += 10;
    reasons.push("English proficiency can strengthen application quality.");
  }

  const capped = Math.max(0, Math.min(score, 100));
  return {
    score: capped,
    confidence: confidenceFromScore(capped),
    reasons,
  };
}

export function recommendVisas(profile) {
  // Static knowledge base has been removed.
  // This service now returns no hardcoded recommendations.
  // Recommendation generation can be sourced dynamically (e.g., LLM/API) later.
  void profile;
  return [];
}

export function generateChecklist(visaOption) {
  return {
    checklist: visaOption.docTemplate || [],
    sourceCitations: visaOption.sourceCitations || [],
    lastVerifiedAt: visaOption.lastVerifiedAt || null,
  };
}
