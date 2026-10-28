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

## User Onboarding & Identity Mapping Flow

1. **Welcome Modal**: When a user first opens Dude AI, a friendly welcome dialog greets them:
   > *"Hello! Welcome to Dude AI. Before we get started, please share your details."*
2. **Identity Collection & Validation**:
   - `What should we call you?`: Display username field.
   - `What is your User ID?`: User ID field (employee ID, username, or Atlassian account ID).
   - `Let's Get Started`: Validates that both fields are non-empty before proceeding.
   - Upon submission, a personalized welcome message (`Welcome, <Username>!`) is displayed, and the profile is saved locally and displayed in the topbar user badge.
3. **Identity Headers & Security**:
   - Sent via `X-User-Name` and `X-User-ID` request headers and associated request bodies to the FastAPI backend.
   - Passwords and API tokens remain strictly ephemeral and are never stored or logged.
4. **Jira Account Validation**:
   - The backend checks the entered `user_id` against Jira Cloud's `/rest/api/3/myself` `accountId`.
   - If the ID does not match the authenticated Jira Cloud account ID, it is recorded accurately as an internal application ID, and the UI never falsely claims Jira accepted or verified it.
5. **Audit Attribution**:
   - Every API request, button click, and imported Jira issue records the user name and user ID in `api_audit_tracker.xlsx` (`API Call Log`, `Button Click Log`, and `Imported Jira Issues`).

## Security Vulnerability JSON Importer

Dude AI includes an automated vulnerability issue import workflow:
1. **Sample Vulnerabilities File**: `security_vulnerabilities.json` located at the project root contains 6 Jira-style security findings (e.g. Password Exposure, User ID Disclosure, Revenue Data Exposure, Potential Malware, Missing API Authorization, Sensitive Data Leakage).
2. **File Selection & Client Preview**:
   - Users can select a local JSON file or click **Load Sample Vulnerabilities** to preview all 6 issues.
   - The preview table details issue type (`Bug`), priority (`Highest`/`High`), summary, labels, and description snippets.
3. **Target Project Mapping**:
   - The user selects or inputs their active Jira project key (e.g. `DEMO`).
   - The importer maps template project keys (e.g. `DAST`) directly to the target project instead of assuming `DAST` exists.
4. **Jira API V3 Integration & Resilient Creation**:
   - Issues are created individually on Jira Cloud via `POST /rest/api/3/issue`.
   - Issue descriptions are formatted in Atlassian Document Format (ADF).
   - If a target project restricts issue types (e.g. non-software projects without `Bug`), the importer automatically falls back to `Task`.
5. **Duplicate Prevention & Observability**:
   - Issues with existing summaries in the target project are skipped and clearly reported.
   - All imports are stored in SQLite and appended to `Imported Jira Issues` in `api_audit_tracker.xlsx`.
   - Results show direct clickable links to browse the created issues on Jira Cloud.

## How it works

1. Share your name and user ID in the welcome dialog.
2. Enter Jira base URL, Atlassian account email, and API token.
3. Click **Test connection** to verify the account and identity status.
4. Click **Load projects**, select a project, and click **Fetch documents**.
5. Use **Import Vulnerabilities** to preview and import Jira-style JSON vulnerability records into your Jira project.
6. Open **Documents** to search imported issues, open issues in Jira, or download the Excel audit tracker.

Jira issue search uses the current enhanced endpoint `/rest/api/3/search/jql`. The API token is sent to the backend for each request and is not written to the SQLite database. Imported issue data is stored in `backend/dude_ai.db`.

This is a learning starter, not a production-ready app. Keep the API token private and only import projects you are authorized to access.


## API Logging, Excel Workbook & Report Downloads

- **Workbook Creation**: The Excel workbook `api_audit_tracker.xlsx` is created automatically during backend startup (in FastAPI's lifespan event). If the workbook already exists, it is loaded safely without deleting or overwriting any existing audit logs.
- **Seven Comprehensive Worksheets**:
  1. `API Call Log`: API method, path, HTTP status, backend duration ms, frontend action, click ID, and duplicate blocked flag. No credentials or request bodies are logged.
  2. `Jira API Call Log`: Every outbound Jira REST call, HTTP status, and actual Jira response duration.
  3. `Button Click Log`: Accepted and blocked click events, click sequence, route, endpoint, result, and frontend duration.
  4. `Button Click Summary`: Consolidated action counts, accepted vs. blocked clicks, and pass/fail counts.
  5. `QA Test Cases`: 10 comprehensive starter QA test scenarios (UI, Concurrency, Security, Idempotency, E2E, Resilience).
  6. `Imported Jira Issues`: Synced issues with keys, summaries, statuses, assignees, and direct Jira URLs.
  7. `Frontend Backend Map`: Complete traceability mapping between React actions, HTTP endpoints, backend handlers, and architectural purposes.
- **Workbook Download Endpoint**:
  - `GET /api/reports/excel`: Downloads the live `api_audit_tracker.xlsx` workbook directly from the running backend with the official XLSX MIME type (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) and filename `api_audit_tracker.xlsx`.
- **Frontend Download Button**:
  - A prominent **Download Excel Report** button is available in the application topbar (accessible from all pages) and on the Documents page toolbar. It connects directly to your configured Render API URL (`https://dudeai.onrender.com/api/reports/excel` in production or `http://127.0.0.1:8000/api/reports/excel` locally).

## Render Persistence Limitations & Durable Storage Architecture

### Why Workbooks and Local Databases Disappear on Standard Render Restarts
Render web services run in stateless, ephemeral Docker containers:
- Whenever code is redeployed, the instance restarts, or a free-tier service wakes from sleep, the container filesystem is restored to its initial git build state.
- Any files written to the local disk during runtime (like `backend/dude_ai.db` or `backend/api_audit_tracker.xlsx`) are erased on restart unless stored on persistent storage.

### How Dude AI Solves This
1. **Automatic Initialization on Startup**: The backend always executes `ensure_excel_tracker()` during `lifespan` startup, ensuring `api_audit_tracker.xlsx` and its 7 worksheets are never missing even after a container reset.
2. **Configurable Data Directory (`DATA_DIR`)**: File paths for both `dude_ai.db` and `api_audit_tracker.xlsx` are resolved through `DATA_DIR` (`Path(os.environ.get("DATA_DIR", Path(__file__).parent))`).
3. **Durable Persistence Options for Production**:
   - **Render Persistent Disks (Recommended on Render)**:
     1. Upgrade the Render web service plan to `starter` or `standard` (persistent disks require a paid plan).
     2. In Render dashboard (or `render.yaml`), add a **Disk** mounted at `/var/data` (e.g. 1 GB).
     3. Add environment variable `DATA_DIR=/var/data`.
     4. Both `dude_ai.db` and `api_audit_tracker.xlsx` will now write directly to `/var/data/` and persist forever across all redeployments and restarts!
   - **Cloud Object Storage (AWS S3, Cloudflare R2, Supabase)**:
     - For production clusters where multiple instances run concurrently, stream the workbook buffer directly to an S3/R2 bucket on each change, and generate presigned download URLs for zero-maintenance cloud durability.
   - **Managed PostgreSQL**:
     - Swap SQLite for Render Managed PostgreSQL (`DATABASE_URL`) to allow multi-worker write concurrency.

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
