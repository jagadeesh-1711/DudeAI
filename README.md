# Dude AI — Jira Knowledge

A small learning project for connecting to Jira Cloud, listing projects, and importing issues. The interface intentionally has only **Jira connection**, **Projects**, and **Documents**. There is no Overview/home dashboard and no AI Assistant page.

## Folder structure

```text
DudeAI/
  backend/
    main.py
    requirements.txt
  frontend/
    index.html
    package.json
    vite.config.js
    src/
      main.jsx
      App.jsx
      styles.css
  README.md
```

## Environment files and GitHub safety

- `.venv/` is the Python virtual-environment **folder**. Create it on your own computer; never upload it to GitHub. Each developer/host installs dependencies from `backend/requirements.txt`.
- `.env` is a local configuration file and must not be committed. The repository includes `frontend/.env.example` as a safe template. Copy it to `frontend/.env` for local development and change `VITE_API_BASE_URL` if needed.
- Do not put Jira API tokens or passwords in a frontend `.env` file. Anything prefixed with `VITE_` is exposed to the browser bundle. Enter Jira credentials into the app when using it.
- `.gitignore` excludes virtual environments, `.env` files, the local database, and the Excel audit workbook from Git. `.env.example` is intentionally tracked.

## Run on Windows

### 1. Backend — terminal one

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app
```

If Python 3.12 is not installed, use a supported installed Python version. Run the backend without `--reload` so the development server does not repeatedly restart while watching the virtual environment.

API documentation: http://127.0.0.1:8000/docs

### 2. Frontend — terminal two

```powershell
cd frontend
Copy-Item .env.example .env   # first time only; creates a local, ignored config file
npm install
npm run dev
```

Open http://127.0.0.1:5173.

## How it works

1. Enter Jira base URL, Atlassian account email, and API token.
2. Click **Test connection** to verify the account.
3. Click **Load projects**, select a project, and click **Fetch documents**.
4. Open **Documents** to search imported issues and open an issue in Jira.

Jira issue search uses the current enhanced endpoint `/rest/api/3/search/jql`. The API token is sent to the local backend for each request and is not written to the SQLite database. Imported issue data is stored locally in `backend/dude_ai.db`.

This is a learning starter, not a production-ready app. Keep the API token private and only import projects you are authorized to access.


## API logging and terminal output

- Every `/api/...` request is appended to `backend/api_audit_tracker.xlsx` in the `API Call Log` sheet. The log stores request path, method, status, duration and frontend action; it never stores request bodies or API tokens.
- The `Frontend Backend Map` sheet maps React actions to FastAPI endpoints and handler functions.
- Imported issues are printed in the backend terminal and written to the `Imported Jira Issues` sheet.
- The workbook is created automatically when the backend starts. It is saved on your own computer at `backend/api_audit_tracker.xlsx`. The Git ignore rules keep it out of commits, so you can open it in Excel locally without publishing Jira data. Back it up by copying the workbook to a private local folder; do not add it to a public repository.

## Visual theme

The refreshed theme uses a deep teal sidebar, mint/soft-green surfaces and orange action accents inspired by the HelpDude screenshot. This is a visual interpretation of the supplied reference, not a claim that these are Supporticon's official brand hex codes.

## QA / click-protection and Excel reporting

The backend writes to `backend/api_audit_tracker.xlsx`. Sheets include:

- `API Call Log`: API method, route, status, elapsed backend time, frontend action, click ID and blocked flag. Credentials/request bodies are not logged.
- `Button Click Log`: accepted and blocked click events, click sequence, route, endpoint, result and frontend elapsed time.
- `Jira API Call Log`: each outbound Jira REST call, HTTP status and actual Jira response duration.
- `Button Click Summary`: totals by action, counting unique click IDs so the start/end events for a single click are not double-counted.
- `QA Test Cases`: starter QA scenarios covering UI, duplicate clicks, API errors, data integrity, secrets and end-to-end workflows.
- `Imported Jira Issues`: the imported issue details.
- `Frontend Backend Map`: frontend-to-backend endpoint map.

The frontend prevents overlapping actions using a synchronous guard and records blocked attempts. The backend also rejects concurrent duplicate action requests with HTTP 409; backend-side 409 rejections are recorded in both the API log and Button Click Log, including requests that bypass the frontend. This is an in-flight duplicate guard, not a permanent once-per-day limit; after the previous request completes, a new intentional action is allowed. For a multi-worker production deployment, move this guard and audit data to a shared store such as Redis/database instead of in-process memory and an Excel file.

### Playwright smoke tests

From `frontend` run:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

These browser tests mock Jira/backend responses and do not need real Jira credentials. They verify duplicate-click blocking, project loading, and error handling. They are starter tests and should be expanded with authorized staging-environment integration tests before production use.

### QA approach reference

The test-case columns and scenarios are informed by public testing guidance: Playwright recommends user-visible checks, isolated tests and resilient locators; ISTQB describes logging test case identity, start/end times, execution status and timing; OWASP API testing guidance discusses checking rejection behavior for bursts of requests. These are industry guidance, not claims about a specific company's internal test template.


## Logo and browser branding

- The supplied Dude AI wordmark is stored at `frontend/public/dude-ai-logo.png` and shown in the sidebar.
- The cropped brand mark is used as the browser favicon at `frontend/public/dude-ai-mark.png`.
- Vite serves files in `frontend/public` from the site root.

## GitHub Repository & Live Deployments

- **GitHub Repository**: [https://github.com/jagadeesh-1711/DudeAI](https://github.com/jagadeesh-1711/DudeAI)
- **Frontend (Vercel)**: [https://dude-ai-roan.vercel.app/](https://dude-ai-roan.vercel.app/)
- **Backend API (Render)**: [https://dudeai.onrender.com](https://dudeai.onrender.com)
  - API Health Check: [https://dudeai.onrender.com/api/health](https://dudeai.onrender.com/api/health)
  - Interactive API Docs: [https://dudeai.onrender.com/docs](https://dudeai.onrender.com/docs)

### Git Commands to Push to GitHub

From the project root:

```powershell
# 1. Initialize git if not already initialized
git init

# 2. Stage all project files (local secrets and database are excluded by .gitignore)
git add .

# 3. Create the commit
git commit -m "Production release: configure Vercel and Render deployments, fix CORS, and wire API endpoints"

# 4. Set branch to main and connect remote
git branch -M main
git remote add origin https://github.com/jagadeesh-1711/DudeAI.git

# 5. Push to GitHub
git push -u origin main --force
```

### Production Hosting Configuration

#### 1. Frontend on Vercel (`https://dude-ai-roan.vercel.app`)
- **Root Directory**: Leave blank or set to `frontend`. (Both root `vercel.json` and `frontend/vercel.json` are provided).
- **Framework Preset**: Vite
- **Build Command**: `npm run build` (or automatic via `package.json`)
- **Output Directory**: `dist` (or `frontend/dist` if deploying from root)
- **Environment Variables**:
  - `VITE_API_BASE_URL`: `https://dudeai.onrender.com` (also baked in by default in `frontend/.env.production` during production builds)

#### 2. Backend on Render (`https://dudeai.onrender.com`)
- **Runtime**: Python 3
- **Root Directory**: `backend` (or root with `render.yaml`)
- **Build Command**: `pip install -r requirements.txt` (or `pip install -r backend/requirements.txt`)
- **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT` (or `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`)
- **Environment Variables**:
  - `PYTHON_VERSION`: `3.11.10`
  - `ALLOWED_ORIGINS`: `https://dude-ai-roan.vercel.app,https://dudeai.onrender.com`
- CORS is configured to allow requests from `https://dude-ai-roan.vercel.app`, Vercel preview URLs, and local development ports.
