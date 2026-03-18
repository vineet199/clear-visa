import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, Link, useNavigate } from "react-router-dom";
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
  "United States", "Germany", "Saudi Arabia", "United Kingdom", "United Arab Emirates",
  "France", "Canada", "Australia", "Spain", "Italy", "Russia", "Turkey", "India",
  "Ukraine", "South Africa", "Thailand", "Malaysia", "Netherlands", "Sweden", "Singapore",
  "Switzerland", "Austria", "Belgium", "Norway", "Denmark", "Ireland", "New Zealand",
  "Portugal", "Poland", "Czech Republic", "Japan", "South Korea", "Israel", "Qatar",
  "Kuwait", "Oman", "Bahrain", "Jordan", "Lebanon", "Mexico", "Brazil", "Argentina",
  "Chile", "Panama", "Costa Rica", "Dominican Republic", "China", "Hong Kong", "Taiwan", "Finland",
];

const ENGLISH_REQUIRED_COUNTRIES = new Set([
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "New Zealand",
  "Ireland",
  "Singapore",
]);

const PROACTIVE_CHAT_QUESTIONS = [
  "What is your country of origin?",
  "Which destination country are you aiming for?",
  "What is your primary purpose (work, study, tourism, or family)?",
  "How many years of relevant experience do you have?",
  "What is your approximate budget in USD for the migration process?",
  "How would you rate your English level (A1 to C2)?",
];

function Landing() {
  return (
    <section className="card">
      <h1>LLM Powered Migration & Visa Assistant</h1>
      <p>
        Explore visa pathways, estimate eligibility, generate document checklists, and ask follow-up questions.
      </p>
      <ul>
        <li>Personalized visa recommendations</li>
        <li>Eligibility score with reasoning and confidence</li>
        <li>Context-aware assistant and exportable PDF report</li>
      </ul>
    </section>
  );
}

function AdminPage() {
  return (
    <section className="card">
      <h2>Admin</h2>
      <p className="muted">
        Admin mode is enabled for development. You can later wire management tools, moderation, and analytics here.
      </p>
    </section>
  );
}

function Auth({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const result =
        mode === "login"
          ? await login({ email: form.email, password: form.password })
          : await register(form);
      setAuthToken(result.token);
      onAuthed(result);
      navigate("/dashboard");
    } catch {
      setError("Authentication failed. Please verify details.");
    }
  };

  return (
    <section className="card">
      <h2>{mode === "login" ? "Login" : "Create account"}</h2>
      <form onSubmit={submit} className="grid">
        {mode === "register" && (
          <label>
            Full name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
        )}
        <label>
          Email
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button>{mode === "login" ? "Sign in" : "Register"}</button>
      </form>
      <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Register" : "Already have an account? Login"}
      </button>
    </section>
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
  const englishRequired = ENGLISH_REQUIRED_COUNTRIES.has(profile.destinationCountry);

  const canAnalyze = useMemo(() => profile.countryOfOrigin && profile.destinationCountry && profile.purpose, [profile]);

  useEffect(() => {
    if (activePanel !== "chat") return;
    if (chat.length > 0) return;

    setChat([
      {
        role: "assistant",
        text:
          "Hi! I’m your visa assistant bot. I’ll ask you a few quick questions to understand your case better.",
      },
      {
        role: "assistant",
        text: PROACTIVE_CHAT_QUESTIONS[0],
      },
    ]);
    setChatStep(0);
  }, [activePanel, chat.length]);

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
    setChecklistMeta({
      sourceCitations: res.sourceCitations || [],
      lastVerifiedAt: res.lastVerifiedAt || null,
    });
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
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: `Thanks — ${PROACTIVE_CHAT_QUESTIONS[nextStep]}`,
        },
      ]);
      return;
    }

    const res = await askChat({ profileId: data?.profileId, message: msg });
    setChat((c) => [
      ...c,
      { role: "assistant", text: res.reply },
      {
        role: "assistant",
        text: "If you’re ready, switch to User Form and click Run analysis for tailored recommendations.",
      },
    ]);
  };

  const saveOptionClick = async (r) => {
    await saveVisaOption({
      profileId: data.profileId,
      visaCode: r.code,
      title: r.title,
      destinationCountry: profile.destinationCountry,
      notes: "Saved from dashboard",
    });
  };

  return (
    <section className={`grid-2 ${activePanel === "chat" ? "chat-mode" : ""}`}>
      <div className="card">
        <div className="panel-toggle" role="tablist" aria-label="Dashboard input mode">
          <button
            className={activePanel === "form" ? "panel-tab active" : "panel-tab"}
            onClick={() => setActivePanel("form")}
          >
            User Form
          </button>
          <button
            className={activePanel === "chat" ? "panel-tab active" : "panel-tab"}
            onClick={() => setActivePanel("chat")}
          >
            Chat
          </button>
        </div>

        {activePanel === "form" ? (
          <>
            <h2>User Intake Form</h2>
            <div className="grid">
              <label>
                Country of origin
                <select
                  value={profile.countryOfOrigin}
                  onChange={(e) => setProfile({ ...profile, countryOfOrigin: e.target.value })}
                >
                  <option value="">Select country</option>
                  {TOP_MIGRATION_COUNTRIES.map((country) => (
                    <option key={`origin-${country}`} value={country}>{country}</option>
                  ))}
                </select>
              </label>

              <label>
                Destination country
                <select
                  value={profile.destinationCountry}
                  onChange={(e) => {
                    const destinationCountry = e.target.value;
                    const needsEnglish = ENGLISH_REQUIRED_COUNTRIES.has(destinationCountry);
                    setProfile({
                      ...profile,
                      destinationCountry,
                      englishLevel: needsEnglish ? profile.englishLevel || "b2" : "",
                    });
                  }}
                >
                  {TOP_MIGRATION_COUNTRIES.map((country) => (
                    <option key={`dest-${country}`} value={country}>{country}</option>
                  ))}
                </select>
              </label>

              <label>
                Purpose
                <select value={profile.purpose} onChange={(e) => setProfile({ ...profile, purpose: e.target.value })}>
                  <option value="work">Work</option>
                  <option value="study">Study</option>
                  <option value="tourism">Tourism</option>
                  <option value="family">Family</option>
                </select>
              </label>

              <label>
                Education level
                <select
                  value={profile.educationLevel}
                  onChange={(e) => setProfile({ ...profile, educationLevel: e.target.value })}
                >
                  <option value="high school">High school</option>
                  <option value="diploma">Diploma</option>
                  <option value="bachelor">Bachelor</option>
                  <option value="master">Master</option>
                  <option value="phd">PhD</option>
                </select>
              </label>

              <label>
                Years of experience
                <input
                  type="number"
                  min="0"
                  value={profile.yearsExperience}
                  onChange={(e) => setProfile({ ...profile, yearsExperience: Number(e.target.value || 0) })}
                />
              </label>

              <label>
                Budget (USD)
                <input
                  type="number"
                  min="0"
                  value={profile.budgetUsd}
                  onChange={(e) => setProfile({ ...profile, budgetUsd: Number(e.target.value || 0) })}
                />
              </label>

              {englishRequired ? (
                <label>
                  English level (required for selected destination)
                  <select
                    value={profile.englishLevel || "b2"}
                    onChange={(e) => setProfile({ ...profile, englishLevel: e.target.value })}
                  >
                    <option value="a1">A1</option>
                    <option value="a2">A2</option>
                    <option value="b1">B1</option>
                    <option value="b2">B2</option>
                    <option value="c1">C1</option>
                    <option value="c2">C2</option>
                  </select>
                </label>
              ) : (
                <p className="muted">English level is optional for this destination and won’t be required for analysis.</p>
              )}

              <label>
                Notes
                <input
                  value={profile.notes}
                  onChange={(e) => setProfile({ ...profile, notes: e.target.value })}
                />
              </label>
            </div>
            <button className="analyze-btn" disabled={!canAnalyze || loading} onClick={run}>
              {loading ? "Analyzing..." : "Run analysis"}
            </button>
          </>
        ) : (
          <>
            <h2>Chat</h2>
            <div className="chat-shell">
              <div className="chatbox ai-chatbox">
                {chat.map((m, i) => (
                  <div key={i} className={`chat-row ${m.role === "user" ? "user" : "assistant"}`}>
                    <div className="chat-avatar">{m.role === "user" ? "You" : "AI"}</div>
                    <div className="chat-bubble">{m.text}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="chat-composer">
              <input
                placeholder="Type your response..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
              />
              <button onClick={send}>Send</button>
            </div>
          </>
        )}
      </div>

      {activePanel === "form" && (
        <div className="card">
          <h2>Recommendations</h2>
          {!data && <p>No analysis yet.</p>}
          {data?.summary && <p>{data.summary}</p>}
          <p className="muted">{data?.disclaimer || "This is not legal advice."}</p>
          {data?.recommendations?.map((r) => (
            <div key={r.code} className="option">
              <strong>{r.title}</strong>
              <p>Eligibility: {r.eligibilityScore}/100 ({r.confidence} confidence)</p>
              <p>Processing: {r.processingMonths}</p>
              {r.lastVerifiedAt && <p className="muted">Last verified: {r.lastVerifiedAt}</p>}
              {r.sourceCitations?.length > 0 && (
                <div>
                  <p className="muted"><b>Sources</b></p>
                  <ul>
                    {r.sourceCitations.map((s) => (
                      <li key={`${r.code}-${s.url}`}>
                        <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button onClick={() => getChecklist(r.code)}>Checklist</button>
              <button onClick={() => saveOptionClick(r)}>Save</button>
            </div>
          ))}
        </div>
      )}

      {showChecklistModal && (
        <div className="modal-overlay" onClick={() => setShowChecklistModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Checklist {checklistVisaTitle ? `• ${checklistVisaTitle}` : ""}</h3>
              <button className="modal-close" onClick={() => setShowChecklistModal(false)}>Close</button>
            </div>

            {checklist.length > 0 ? (
              <ul>
                {checklist.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">No checklist items available.</p>
            )}

            {checklistMeta.lastVerifiedAt && (
              <p className="muted">Checklist last verified: {checklistMeta.lastVerifiedAt}</p>
            )}

            {checklistMeta.sourceCitations?.length > 0 && (
              <div>
                <p className="muted"><b>Checklist Sources</b></p>
                <ul>
                  {checklistMeta.sourceCitations.map((s) => (
                    <li key={`check-${s.url}`}>
                      <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SavedOptionsPage() {
  const [saved, setSaved] = useState([]);

  useEffect(() => {
    listSavedOptions().then(setSaved).catch(() => setSaved([]));
  }, []);

  return (
    <section className="card">
      <h2>Saved Visa Options</h2>
      <button onClick={async () => setSaved(await listSavedOptions())}>Refresh</button>
      <ul>
        {saved.map((s) => (
          <li key={s._id}>{s.title} ({s.destinationCountry})</li>
        ))}
      </ul>
    </section>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(DEV_AUTO_LOGIN || !AUTH_PAGE_ENABLED);

  return (
    <div className="container">
      <nav className="nav">
        <Link to="/">Home</Link>
        {AUTH_PAGE_ENABLED && <Link to="/auth">Auth</Link>}
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/saved">Saved</Link>
        {ADMIN_PAGE_ENABLED && <Link to="/admin">Admin</Link>}
      </nav>

      <Routes>
        <Route path="/" element={<Landing />} />
        {AUTH_PAGE_ENABLED ? (
          <Route path="/auth" element={<Auth onAuthed={() => setAuthed(true)} />} />
        ) : (
          <Route path="/auth" element={<Navigate to="/dashboard" replace />} />
        )}
        <Route path="/dashboard" element={authed ? <Dashboard /> : <Navigate to="/auth" />} />
        <Route path="/saved" element={authed ? <SavedOptionsPage /> : <Navigate to="/auth" />} />
        {ADMIN_PAGE_ENABLED && <Route path="/admin" element={<AdminPage />} />}
      </Routes>
    </div>
  );
}
