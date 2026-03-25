import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, Link, useLocation, useNavigate } from "react-router-dom";
import {
  analyzeProfile,
  askChat,
  fetchChecklist,
  listSavedOptions,
  login,
  register,
  saveVisaOption,
  setAuthToken,
} from "./api";

const ADMIN_PAGE_ENABLED = import.meta.env.VITE_ENABLE_ADMIN_PAGE === "true";
const AUTH_PAGE_ENABLED = import.meta.env.VITE_ENABLE_AUTH_PAGE !== "false";
const DEV_AUTO_LOGIN = import.meta.env.VITE_DEV_AUTO_LOGIN === "true";

const TOP_MIGRATION_COUNTRIES = [
  "United States","Germany","Saudi Arabia","United Kingdom","United Arab Emirates",
  "France","Canada","Australia","Spain","Italy","Russia","Turkey","India",
  "Ukraine","South Africa","Thailand","Malaysia","Netherlands","Sweden","Singapore",
  "Switzerland","Austria","Belgium","Norway","Denmark","Ireland","New Zealand",
  "Portugal","Poland","Czech Republic","Japan","South Korea","Israel","Qatar",
  "Kuwait","Oman","Bahrain","Jordan","Lebanon","Mexico","Brazil","Argentina",
  "Chile","Panama","Costa Rica","Dominican Republic","China","Hong Kong","Taiwan","Finland",
];

const ENGLISH_REQUIRED_COUNTRIES = new Set([
  "United States","United Kingdom","Canada","Australia","New Zealand","Ireland","Singapore",
]);

const PROACTIVE_CHAT_QUESTIONS = [
  "What is your country of origin?",
  "Which destination country are you aiming for?",
  "What is your primary purpose — work, study, tourism, or family?",
  "How many years of relevant experience do you have?",
  "What is your approximate budget in USD for the migration process?",
  "How would you rate your English level (A1 to C2)?",
];

function getScoreColor(score) {
  if (score >= 70) return "#34d399";
  if (score >= 45) return "#fbbf24";
  return "#f87171";
}

function getScoreBadgeClass(score) {
  if (score >= 70) return "rec-badge high";
  if (score >= 45) return "rec-badge medium";
  return "rec-badge low";
}

function formatFieldLabel(field) {
  return String(field || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function buildActualScoreReasons(officialScore, recommendation) {
  const breakdown = Array.isArray(officialScore?.breakdown) ? officialScore.breakdown : [];
  const score = Number(officialScore?.score);
  const maxScore = Number(officialScore?.maxScore);
  const missingFields = Array.isArray(officialScore?.missingRequiredFields)
    ? officialScore.missingRequiredFields.filter(Boolean)
    : [];

  if (!breakdown.length || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    return Array.isArray(recommendation?.reasoning) && recommendation.reasoning.length > 0
      ? recommendation.reasoning
      : ["This score explanation is based on the recommendation logic currently returned by the API."];
  }

  const normalizedBreakdown = breakdown.map((item) => {
    const points = Number(item?.points || 0);
    const itemMax = Number(item?.maxPoints || 0);
    const ratio = itemMax > 0 ? points / itemMax : 0;

    return {
      label: String(item?.label || "Factor"),
      points,
      maxPoints: itemMax,
      ratio,
      note: item?.note ? String(item.note) : "",
    };
  });

  const strongestFactors = normalizedBreakdown
    .filter((item) => item.points > 0)
    .sort((a, b) => b.ratio - a.ratio || b.points - a.points)
    .slice(0, 2);

  const limitingFactors = normalizedBreakdown
    .filter((item) => item.maxPoints > 0 && item.ratio <= 0.35)
    .sort((a, b) => a.ratio - b.ratio || a.points - b.points)
    .slice(0, 2);

  const reasons = [
    `This recommendation is using your latest official-style score of ${score}/${maxScore}${officialScore?.band ? ` (${officialScore.band} band)` : ""}.`,
  ];

  strongestFactors.forEach((item) => {
    reasons.push(
      `${item.label} is helping your score (${item.points}/${item.maxPoints || "?"})${item.note ? `. ${item.note}` : "."}`
    );
  });

  limitingFactors.forEach((item) => {
    reasons.push(`${item.label} is currently limiting your score (${item.points}/${item.maxPoints || "?"}).`);
  });

  if (missingFields.length > 0) {
    reasons.push(`Missing profile inputs affecting accuracy: ${missingFields.map(formatFieldLabel).join(", ")}.`);
  }

  if (Array.isArray(recommendation?.reasoning) && recommendation.reasoning[0]) {
    reasons.push(`Why this pathway still appears: ${recommendation.reasoning[0]}`);
  }

  return reasons;
}

function ScoreBar({ score }) {
  const color = getScoreColor(score);
  return (
    <div className="score-bar-wrap">
      <div className="score-bar-label">
        <span>Eligibility score</span>
        <span style={{ color, fontWeight: 700 }}>{score}/100</span>
      </div>
      <div className="score-bar">
        <div
          className="score-bar-fill"
          style={{ width: `${score}%`, background: `linear-gradient(90deg, ${color}80, ${color})` }}
        />
      </div>
    </div>
  );
}

function NavLink({ to, children }) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
  return (
    <Link to={to} className={`nav-link${isActive ? " active" : ""}`}>
      {children}
    </Link>
  );
}

function Landing() {
  return (
    <div>
      <div className="landing-hero">
        <div className="landing-badge">
          <span>✦</span>
          <span>AI-Powered Immigration Intelligence</span>
        </div>
        <h1>Your Global Migration<br />Journey Starts Here</h1>
        <p>
          Get personalized visa recommendations, eligibility assessments,
          and AI-generated document checklists — all in one place.
        </p>
        <div className="landing-cta">
          <Link to={AUTH_PAGE_ENABLED ? "/auth" : "/dashboard"} className="btn btn-primary btn-lg">
            Get Started Free →
          </Link>
          <Link to="/dashboard" className="btn btn-ghost btn-lg">
            Explore Dashboard
          </Link>
        </div>
        <div className="landing-features">
          {[
            {
              icon: "🎯",
              bg: "rgba(79,140,255,0.12)",
              title: "Personalized Recommendations",
              desc: "AI analyzes your profile to rank visa pathways by eligibility score and confidence.",
            },
            {
              icon: "📋",
              bg: "rgba(52,211,153,0.1)",
              title: "Document Checklists",
              desc: "Auto-generate verified checklists for every visa type with source citations.",
            },
            {
              icon: "💬",
              bg: "rgba(167,139,250,0.1)",
              title: "Context-Aware Chat",
              desc: "Ask follow-up questions to a visa assistant that knows your profile.",
            },
            {
              icon: "📄",
              bg: "rgba(251,191,36,0.1)",
              title: "Exportable Reports",
              desc: "Download a complete PDF summary of your analysis and recommendations.",
            },
          ].map((f) => (
            <div key={f.title} className="feature-card">
              <div className="feature-icon" style={{ background: f.bg }}>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Auth({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result =
        mode === "login"
          ? await login({ email: form.email, password: form.password })
          : await register(form);
      setAuthToken(result.token);
      onAuthed(result);
      navigate("/dashboard");
    } catch {
      setError("Authentication failed. Please check your details and try again.");
    } finally {
      setLoading(false);
    }
  };

  const field = (key, label, type = "text", placeholder = "") => (
    <label>
      {label}
      <input
        type={type}
        value={form[key]}
        placeholder={placeholder}
        autoComplete={type === "password" ? "current-password" : key}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">✈️</div>
        <h2 className="auth-title">{mode === "login" ? "Welcome back" : "Create account"}</h2>
        <p className="auth-sub">
          {mode === "login"
            ? "Sign in to access your visa dashboard"
            : "Start your global migration journey today"}
        </p>

        <form onSubmit={submit} className="form-grid">
          {mode === "register" && field("name", "Full Name", "text", "Jane Smith")}
          {field("email", "Email Address", "email", "you@example.com")}
          {field("password", "Password", "password", "••••••••")}

          {error && (
            <div className="error-msg">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading}>
            {loading ? (
              <>
                <div className="spinner" />
                {mode === "login" ? "Signing in…" : "Creating account…"}
              </>
            ) : mode === "login" ? "Sign in →" : "Create account →"}
          </button>
        </form>

        <div className="divider"><span>or</span></div>

        <button
          className="btn-link btn-full"
          style={{ display: "block", textAlign: "center" }}
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
        >
          {mode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

function RecCard({ r, officialScore, onChecklist, onSave }) {
  const [showSources, setShowSources] = useState(false);
  const [showScoreWhy, setShowScoreWhy] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onSave(r);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const badgeClass = getScoreBadgeClass(r.eligibilityScore);
  const badgeLabel = r.eligibilityScore >= 70 ? "High" : r.eligibilityScore >= 45 ? "Medium" : "Low";
  const scoreBandLabel = r.eligibilityScore >= 70 ? "high" : r.eligibilityScore >= 45 ? "medium" : "low";

  const scoreReasons = buildActualScoreReasons(officialScore, r);

  return (
    <div className="rec-card">
      <div className="rec-header">
        <div style={{ flex: 1 }}>
          <div className="rec-title">{r.title}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{r.code}</div>
        </div>
        <div className={badgeClass}>{badgeLabel} Match</div>
      </div>

      <ScoreBar score={r.eligibilityScore} />

      <div className="rec-meta">
        {r.processingMonths && (
          <div className="rec-meta-item">
            <span>⏱</span>
            <span>Processing: {r.processingMonths}</span>
          </div>
        )}
        {r.confidence && (
          <div className="rec-meta-item">
            <span>📊</span>
            <span>Confidence: {r.confidence}</span>
          </div>
        )}
        {r.lastVerifiedAt && (
          <div className="rec-meta-item">
            <span>✓</span>
            <span>Verified: {r.lastVerifiedAt}</span>
          </div>
        )}
      </div>

      <div className="rec-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => setShowScoreWhy((v) => !v)}>
          {showScoreWhy ? "🛈 Hide score reason" : "🛈 Why this score?"}
        </button>
        <button className="btn btn-success btn-sm" onClick={() => onChecklist(r.code)}>
          📋 View Checklist
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleSave}
          disabled={saved}
          style={saved ? { color: "var(--success)", borderColor: "rgba(52,211,153,0.3)" } : {}}
        >
          {saved ? "✓ Saved" : "🔖 Save"}
        </button>
      </div>

      {showScoreWhy && (
        <div className={`score-explain score-${scoreBandLabel}`}>
          <div className="score-explain-title">
            {scoreBandLabel === "high"
              ? "Why this is a high score"
              : scoreBandLabel === "medium"
                ? "Why this is a medium score"
                : "Why this is a low score"}
          </div>
          <ul>
            {scoreReasons.map((reason, idx) => (
              <li key={`${r.code}-why-${idx}`}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {r.sourceCitations?.length > 0 && (
        <>
          <div className="sources-toggle" onClick={() => setShowSources(!showSources)}>
            <span>{showSources ? "▼" : "▶"}</span>
            <span>{r.sourceCitations.length} source{r.sourceCitations.length !== 1 ? "s" : ""}</span>
          </div>
          {showSources && (
            <div className="sources-list">
              {r.sourceCitations.map((s) => (
                <a key={`${r.code}-${s.url}`} href={s.url} target="_blank" rel="noreferrer">
                  🔗 {s.label}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Dashboard() {
  const [activePanel, setActivePanel] = useState("form");
  const [profile, setProfile] = useState({
    countryOfOrigin: "",
    destinationCountry: "Canada",
    purpose: "work",
    educationLevel: "bachelor",
    yearsExperience: 2,
    budgetUsd: 15000,
    englishLevel: "b2",
    notes: "",
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checklist, setChecklist] = useState([]);
  const [checklistMeta, setChecklistMeta] = useState({ sourceCitations: [], lastVerifiedAt: null });
  const [checklistVisaTitle, setChecklistVisaTitle] = useState("");
  const [showChecklistModal, setShowChecklistModal] = useState(false);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStep, setChatStep] = useState(0);
  const chatEndRef = useRef(null);

  const englishRequired = ENGLISH_REQUIRED_COUNTRIES.has(profile.destinationCountry);
  const canAnalyze = useMemo(
    () => profile.countryOfOrigin && profile.destinationCountry && profile.purpose,
    [profile]
  );

  useEffect(() => {
    if (activePanel !== "chat") return;
    if (chat.length > 0) return;
    setChat([
      { role: "assistant", text: "Hi! I'm your visa assistant. I'll ask a few quick questions to understand your case." },
      { role: "assistant", text: PROACTIVE_CHAT_QUESTIONS[0] },
    ]);
    setChatStep(0);
  }, [activePanel, chat.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const run = async () => {
    setLoading(true);
    try {
      const result = await analyzeProfile(profile);
      setData(result);
    } finally {
      setLoading(false);
    }
  };

  const getChecklist = async (visaCode) => {
    if (!data?.profileId) return;
    const res = await fetchChecklist(data.profileId, visaCode);
    const selectedVisa = data?.recommendations?.find((r) => r.code === visaCode);
    setChecklist(res.checklist || []);
    setChecklistVisaTitle(selectedVisa?.title || visaCode);
    setChecklistMeta({ sourceCitations: res.sourceCitations || [], lastVerifiedAt: res.lastVerifiedAt || null });
    setShowChecklistModal(true);
  };

  const send = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput;
    setChatInput("");
    setChat((c) => [...c, { role: "user", text: msg }]);

    if (chatStep < PROACTIVE_CHAT_QUESTIONS.length - 1) {
      const nextStep = chatStep + 1;
      setChatStep(nextStep);
      setTimeout(() => {
        setChat((c) => [...c, { role: "assistant", text: `Got it — ${PROACTIVE_CHAT_QUESTIONS[nextStep]}` }]);
      }, 400);
      return;
    }

    setTimeout(async () => {
      try {
        const res = await askChat({ profileId: data?.profileId, message: msg });
        setChat((c) => [
          ...c,
          { role: "assistant", text: res.reply },
          { role: "assistant", text: "When ready, switch to the Form tab to run a full analysis." },
        ]);
      } catch {
        setChat((c) => [...c, { role: "assistant", text: "Sorry, I couldn't process that. Please try again." }]);
      }
    }, 400);
  };

  const field = (key, label, children) => (
    <label>
      {label}
      {children}
    </label>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Fill your profile and get AI-powered visa recommendations</div>
        </div>
      </div>

      <div className={`dashboard-grid${activePanel === "chat" ? " chat-mode" : ""}`}>
        {/* LEFT PANEL */}
        <div className="card" style={{ padding: "20px" }}>
          <div className="panel-toggle">
            <button
              className={`panel-tab${activePanel === "form" ? " active" : ""}`}
              onClick={() => setActivePanel("form")}
            >
              📝 Profile Form
            </button>
            <button
              className={`panel-tab${activePanel === "chat" ? " active" : ""}`}
              onClick={() => setActivePanel("chat")}
            >
              💬 Chat Assistant
            </button>
          </div>

          {activePanel === "form" ? (
            <>
              <div className="section-title">Your Migration Profile</div>
              <div className="section-sub">Tell us about yourself so we can tailor recommendations</div>

              <div className="form-2col">
                {field(
                  "countryOfOrigin", "Country of Origin",
                  <select
                    value={profile.countryOfOrigin}
                    onChange={(e) => setProfile({ ...profile, countryOfOrigin: e.target.value })}
                  >
                    <option value="">Select country…</option>
                    {TOP_MIGRATION_COUNTRIES.map((c) => (
                      <option key={`origin-${c}`} value={c}>{c}</option>
                    ))}
                  </select>
                )}

                {field(
                  "destinationCountry", "Destination Country",
                  <select
                    value={profile.destinationCountry}
                    onChange={(e) => {
                      const destinationCountry = e.target.value;
                      const needsEnglish = ENGLISH_REQUIRED_COUNTRIES.has(destinationCountry);
                      setProfile({ ...profile, destinationCountry, englishLevel: needsEnglish ? profile.englishLevel || "b2" : "" });
                    }}
                  >
                    {TOP_MIGRATION_COUNTRIES.map((c) => (
                      <option key={`dest-${c}`} value={c}>{c}</option>
                    ))}
                  </select>
                )}

                {field(
                  "purpose", "Primary Purpose",
                  <select value={profile.purpose} onChange={(e) => setProfile({ ...profile, purpose: e.target.value })}>
                    <option value="work">💼 Work</option>
                    <option value="study">🎓 Study</option>
                    <option value="tourism">🌍 Tourism</option>
                    <option value="family">👪 Family</option>
                  </select>
                )}

                {field(
                  "educationLevel", "Education Level",
                  <select value={profile.educationLevel} onChange={(e) => setProfile({ ...profile, educationLevel: e.target.value })}>
                    <option value="high school">High School</option>
                    <option value="diploma">Diploma</option>
                    <option value="bachelor">Bachelor's Degree</option>
                    <option value="master">Master's Degree</option>
                    <option value="phd">PhD</option>
                  </select>
                )}

                {field(
                  "yearsExperience", "Years of Experience",
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={profile.yearsExperience}
                    onChange={(e) => setProfile({ ...profile, yearsExperience: Number(e.target.value || 0) })}
                  />
                )}

                {field(
                  "budgetUsd", "Budget (USD)",
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={profile.budgetUsd}
                    onChange={(e) => setProfile({ ...profile, budgetUsd: Number(e.target.value || 0) })}
                  />
                )}

                {englishRequired ? (
                  field(
                    "englishLevel", "English Level",
                    <select value={profile.englishLevel || "b2"} onChange={(e) => setProfile({ ...profile, englishLevel: e.target.value })}>
                      {["a1","a2","b1","b2","c1","c2"].map((l) => (
                        <option key={l} value={l}>{l.toUpperCase()}</option>
                      ))}
                    </select>
                  )
                ) : (
                  <div style={{ gridColumn: "1 / -1", fontSize: "0.8rem", color: "var(--text-muted)", padding: "8px 0" }}>
                    💡 English level is optional for this destination
                  </div>
                )}

                <label style={{ gridColumn: "1 / -1" }}>
                  Additional Notes
                  <input
                    value={profile.notes}
                    placeholder="Any special circumstances, job offers, family ties…"
                    onChange={(e) => setProfile({ ...profile, notes: e.target.value })}
                  />
                </label>
              </div>

              <button
                className="btn btn-primary btn-full"
                style={{ marginTop: "20px", padding: "13px" }}
                disabled={!canAnalyze || loading}
                onClick={run}
              >
                {loading ? (
                  <><div className="spinner" /> Analyzing your profile…</>
                ) : (
                  "✦ Run AI Analysis"
                )}
              </button>

              {!canAnalyze && (
                <div className="form-hint" style={{ textAlign: "center", marginTop: "8px" }}>
                  Select country of origin, destination & purpose to continue
                </div>
              )}
            </>
          ) : (
            <div className="chat-wrap">
              <div className="chat-messages">
                {chat.map((m, i) => (
                  <div key={i} className={`chat-row ${m.role === "user" ? "user" : "ai"}`}>
                    <div className={`chat-avatar ${m.role === "user" ? "you" : "ai"}`}>
                      {m.role === "user" ? "You" : "AI"}
                    </div>
                    <div className={`chat-bubble ${m.role === "user" ? "you" : "ai"}`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-composer">
                <input
                  placeholder="Type your response…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                />
                <button className="btn btn-primary" onClick={send} style={{ flexShrink: 0 }}>
                  Send
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL — only in form mode */}
        {activePanel === "form" && (
          <div className="card" style={{ padding: "20px" }}>
            <div className="recs-header">
              <div>
                <div className="section-title">Visa Recommendations</div>
                <div className="section-sub">
                  {data
                    ? `${data.recommendations?.length || 0} pathways found`
                    : "Run analysis to see your results"}
                </div>
              </div>
            </div>

            {!data ? (
              <div className="recs-empty">
                <div className="recs-empty-icon">🗺️</div>
                <h3>No analysis yet</h3>
                <p>Fill out your profile and click "Run AI Analysis" to see personalized visa recommendations.</p>
              </div>
            ) : (
              <>
                {data.summary && (
                  <div className="summary-banner">
                    {data.summary}
                  </div>
                )}
                <div className="disclaimer">
                  ⚠ {data.disclaimer || "This information is for guidance only and does not constitute legal advice."}
                </div>
                {data.recommendations?.map((r) => (
                  <RecCard
                    key={r.code}
                    r={r}
                    officialScore={data.officialScore}
                    onChecklist={getChecklist}
                    onSave={async (rec) => {
                      await saveVisaOption({
                        profileId: data.profileId,
                        visaCode: rec.code,
                        title: rec.title,
                        destinationCountry: profile.destinationCountry,
                        notes: "Saved from dashboard",
                      });
                    }}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* CHECKLIST MODAL */}
      {showChecklistModal && (
        <div className="modal-overlay" onClick={() => setShowChecklistModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📋 {checklistVisaTitle || "Document Checklist"}</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowChecklistModal(false)}
              >
                ✕ Close
              </button>
            </div>
            <div className="modal-body">
              {checklist.length > 0 ? (
                checklist.map((item, i) => (
                  <div key={i} className="checklist-item">
                    <div className="check-icon">✓</div>
                    <span>{item}</span>
                  </div>
                ))
              ) : (
                <p className="muted">No checklist items available.</p>
              )}

              {checklistMeta.lastVerifiedAt && (
                <p className="muted" style={{ marginTop: "16px" }}>
                  ✓ Last verified: {checklistMeta.lastVerifiedAt}
                </p>
              )}

              {checklistMeta.sourceCitations?.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Sources
                  </div>
                  <div className="sources-list">
                    {checklistMeta.sourceCitations.map((s) => (
                      <a key={`check-${s.url}`} href={s.url} target="_blank" rel="noreferrer">
                        🔗 {s.label}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SavedOptionsPage() {
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSavedOptions()
      .then(setSaved)
      .catch(() => setSaved([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Saved Options</div>
          <div className="page-sub">Your bookmarked visa pathways</div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            setLoading(true);
            const data = await listSavedOptions().catch(() => []);
            setSaved(data);
            setLoading(false);
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <div className="spinner" style={{ width: "28px", height: "28px", borderWidth: "3px" }} />
        </div>
      ) : saved.length === 0 ? (
        <div className="recs-empty" style={{ paddingTop: "80px" }}>
          <div className="recs-empty-icon">🔖</div>
          <h3>No saved options yet</h3>
          <p>Run an analysis and save visa options from the Dashboard to see them here.</p>
          <Link to="/dashboard" className="btn btn-primary" style={{ marginTop: "20px" }}>
            Go to Dashboard
          </Link>
        </div>
      ) : (
        <div className="saved-grid">
          {saved.map((s) => (
            <div key={s._id} className="saved-card">
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>✈️</div>
              <div className="saved-card-title">{s.title}</div>
              <div className="saved-card-meta">
                📍 {s.destinationCountry}
                {s.notes && s.notes !== "Saved from dashboard" && (
                  <div style={{ marginTop: "4px" }}>{s.notes}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(DEV_AUTO_LOGIN || !AUTH_PAGE_ENABLED);

  return (
    <div className="app-shell">
      {/* Decorative orbs */}
      <div className="glow-orb orb-1" />
      <div className="glow-orb orb-2" />

      <nav className="nav">
        <Link to="/" className="nav-brand">
          <div className="nav-brand-icon">✈</div>
          <span className="nav-brand-text">VisaAI</span>
        </Link>

        <NavLink to="/">Home</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/saved">Saved</NavLink>
        {AUTH_PAGE_ENABLED && <NavLink to="/auth">Sign in</NavLink>}
        {ADMIN_PAGE_ENABLED && <NavLink to="/admin">Admin</NavLink>}
      </nav>

      <main className="page">
        <Routes>
          <Route path="/" element={<Landing />} />
          {AUTH_PAGE_ENABLED ? (
            <Route path="/auth" element={<Auth onAuthed={() => setAuthed(true)} />} />
          ) : (
            <Route path="/auth" element={<Navigate to="/dashboard" replace />} />
          )}
          <Route path="/dashboard" element={authed ? <Dashboard /> : <Navigate to="/auth" />} />
          <Route path="/saved" element={authed ? <SavedOptionsPage /> : <Navigate to="/auth" />} />
          {ADMIN_PAGE_ENABLED && (
            <Route
              path="/admin"
              element={
                <div className="card">
                  <h2 style={{ marginBottom: "8px" }}>Admin</h2>
                  <p className="muted">Admin panel — coming soon.</p>
                </div>
              }
            />
          )}
        </Routes>
      </main>
    </div>
  );
}
