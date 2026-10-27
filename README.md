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

## GitHub repository upload

This ZIP is structured as a repository: open the extracted `DudeAI` folder itself as the project root. It includes the source code, logo assets, tests, and setup documentation. The local Excel audit workbook (`backend/api_audit_tracker.xlsx`) and SQLite database are ignored by Git so private Jira details are not published. The workbook is available on your computer and is created/updated by the backend at runtime. The `frontend/.env.example` template is included, while your real `.env` and `.venv` stay local.

From a terminal opened in the `DudeAI` folder, create an empty GitHub repository first, then run (replace the URL with your own repository URL):

```powershell
git init
git add .
git commit -m "Add Dude AI Jira knowledge app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Do not commit Jira API tokens, `.env` files, the generated audit workbook, or the local database.

### Hosting the frontend like a typical company deployment

A common setup separates the source repository, static frontend hosting, backend hosting, and private data storage:

1. **GitHub** stores source code and version history. Do not use GitHub to store the local audit workbook or secrets.
2. **Frontend hosting**: deploy the `frontend` folder to Vercel or Netlify. Set the build command to `npm run build`, output directory to `dist`, and environment variable `VITE_API_BASE_URL` to your deployed backend URL. GitHub Pages can host a static frontend too, but Vite base-path configuration may be needed for a repository subpath.
3. **Backend hosting**: deploy `backend` to a Python-capable host with start command `uvicorn main:app --host 0.0.0.0 --port $PORT` (adapt to the host's required syntax). Configure CORS for the exact deployed frontend origin.
4. **Persistent data**: use a persistent disk or database for production logs. An Excel workbook stored on a temporary cloud filesystem may disappear on restart, and Excel is not a good shared multi-worker production database.
5. **Credentials**: store server secrets in the backend host's secret/environment settings. Never put Jira API tokens in frontend variables, source code, screenshots, or public logs.

For your requested local Excel record, keep running the backend on your computer: the live workbook is `backend/api_audit_tracker.xlsx`. Public frontend hosting cannot write directly to a workbook on your local PC; the browser talks to the backend, and the backend writes the workbook on the machine where it runs.
