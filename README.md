# LLM Powered Migration and Visa Assistant

Full-stack web application to help users explore visa pathways, estimate eligibility, generate document checklists, and ask context-aware migration questions.

## Tech Stack

- **Frontend:** React + Vite + React Router + Axios
- **Backend:** Node.js + Express
- **Database:** MongoDB (Mongoose)
- **Auth/Security:** JWT auth, password hashing (`bcryptjs`), API rate limiting (`express-rate-limit`)
- **LLM:** OpenAI Responses API (with resilient fallback)
- **Reporting:** PDF export (`pdfkit`)

## Project Structure

```text
.
├── package.json                  # Monorepo root (workspaces + dev scripts)
├── client/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx              # Landing, auth, intake/dashboard/chat UI
│       ├── api.js               # Frontend API bindings
│       └── styles.css
└── server/
    ├── .env.example
    ├── package.json
    └── src/
        ├── index.js             # Express app bootstrap
        ├── lib/
        │   ├── db.js            # MongoDB connection
        │   └── llm.js           # OpenAI wrapper + fallback behavior
        ├── middleware/
        │   └── auth.js          # JWT auth guard
        ├── data/
        │   └── visaKnowledgeBase.js
        ├── models/
        │   ├── User.js
        │   ├── Profile.js
        │   ├── QueryHistory.js
        │   └── SavedVisaOption.js
        ├── services/
        │   └── eligibility.js   # score + confidence + checklist logic
        └── routes/
            ├── auth.routes.js
            ├── visa.routes.js
            └── chat.routes.js
```

## Key Features Implemented

1. **Landing Page** with feature overview and professional UX tone.
2. **User Intake Form** capturing origin/destination/purpose/education/experience/budget/language.
3. **Dashboard** with:
   - ranked visa recommendations,
   - eligibility score + confidence (`high/medium/low`),
   - reasoning,
   - dynamic document checklist,
   - source citations + last-verified metadata,
   - processing time estimates,
   - saved options list,
   - exportable PDF report.
4. **Context-aware chat** using profile context where available.
5. **Data persistence** for profiles, saved options, and query/chat history.
6. **Security/compliance basics**:
   - JWT auth,
   - rate limiting,
   - avoids storing sensitive data beyond core account/profile fields.
7. **LLM safety constraints**:
   - concise responses,
   - uncertainty framing,
   - explicit disclaimer: **“This is not legal advice.”**
   - fallback response if LLM call fails.

## API Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/visa/analyze`
- `GET /api/visa/checklist/:profileId/:visaCode`
- `POST /api/visa/save-option`
- `GET /api/visa/saved-options`
- `GET /api/visa/export/:profileId`
- `POST /api/chat`
- `GET /api/health`

## Example LLM Prompts

### Analysis Prompt
**System:**
"You are a migration assistant. Be concise, include uncertainty, and always include: This is not legal advice."

**User:**
`Profile: { ...user profile... }. Recommendations: { ...ranked recommendations... }`

### Chat Prompt
**System:**
"You are a migration and visa assistant. Use simple language, avoid guarantees, include uncertainty if relevant, and always include: This is not legal advice."

**User:**
`Profile: ...\nUser question: ...`

## Eligibility Score Heuristic

Computed in `server/src/services/eligibility.js` with capped 0–100 score:

- +25: purpose alignment
- +25: experience threshold met
- +25: budget threshold met
- +15: education supports skilled pathways
- +10: English proficiency support

Confidence bands:
- `high`: >= 75
- `medium`: 45–74
- `low`: < 45

## Setup Instructions

1. **Install dependencies (root + workspaces):**
   ```bash
   npm install
   ```
2. **Configure environment:**
   ```bash
   cp server/.env.example server/.env
   ```
   Update values for `MONGODB_URI`, `JWT_SECRET`, and your chosen LLM provider keys.

   For frontend env (admin page toggle):
   ```bash
   cp client/.env.example client/.env
   ```
3. **Run app (frontend + backend):**
   ```bash
   npm run dev
   ```
4. Open frontend at `http://localhost:5173`.
5. Backend API runs at `http://localhost:4000`.

## LLM Provider Switching (OpenAI / Gemini / Ollama)

The backend supports multiple providers via `LLM_PROVIDER` in `server/.env`:

```env
LLM_PROVIDER=openai   # or gemini or ollama
```

### 1) OpenAI
```env
LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini
```

### 2) Gemini (Google AI Studio)
```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-1.5-flash
```

### 3) Ollama (local/free)
```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
```

If a provider call fails, the app returns a safe fallback response with disclaimer.

## Development Admin Page Toggle

You can show/hide the admin page using frontend env variable:

```env
VITE_ENABLE_ADMIN_PAGE=true
```

- `true`: shows **Admin** nav item and `/admin` route
- `false`: hides admin page completely (default)

## Development Auth Page Toggle + Auto Login

Use frontend env flags in `client/.env`:

```env
VITE_ENABLE_AUTH_PAGE=true
VITE_DEV_AUTO_LOGIN=false
```

- `VITE_ENABLE_AUTH_PAGE=false`
  - hides **Auth** nav item
  - disables `/auth` page (redirects to `/dashboard`)
- `VITE_DEV_AUTO_LOGIN=true`
  - starts app in authenticated mode for development shortcuts

Recommended for quick local iteration:

```env
VITE_ENABLE_AUTH_PAGE=false
VITE_DEV_AUTO_LOGIN=true
```

If backend protected routes return `401 Unauthorized` in this mode, enable server dev bypass in `server/.env`:

```env
DEV_AUTH_BYPASS=true
DEV_AUTH_USER_ID=dev-user
DEV_AUTH_EMAIL=dev@example.com
```

Then restart backend/dev server.

## Citation & Source Transparency

- Visa knowledge entries include `sourceCitations` and `lastVerifiedAt`.
- Recommendation API responses propagate citations per visa option.
- Checklist API response includes citations and verification timestamp.
- UI renders clickable source links for recommendations and checklist.
- PDF export includes source URLs for each recommended pathway.

## Notes

- Country visa dataset is sample/mock and should be extended before production use.
- Recommendations are assistive and **not legal advice**.
- Add production hardening next: input validation library, audit logging, tests, CSRF/session strategy if moving to cookie auth.
