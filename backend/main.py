"""Dude AI - simple Jira connection and issue importer for learning."""
import os
from contextlib import asynccontextmanager
from pathlib import Path
import sqlite3
import time
from datetime import datetime
from threading import Lock
from urllib.parse import urlparse

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from pydantic import BaseModel, HttpUrl, Field

DB_FILE = Path(__file__).with_name("dude_ai.db")
EXCEL_FILE = Path(__file__).with_name("api_audit_tracker.xlsx")
EXCEL_LOCK = Lock()
ACTIVE_ACTIONS = set()
ACTIVE_ACTIONS_LOCK = Lock()


def style_sheet(ws):
    header_fill = PatternFill("solid", fgColor="174A45")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for column_cells in ws.columns:
        width = min(max(max(len(str(cell.value or "")) for cell in column_cells) + 2, 12), 52)
        ws.column_dimensions[get_column_letter(column_cells[0].column)].width = width


def ensure_excel_tracker():
    if EXCEL_FILE.exists():
        # Migrate workbooks created by earlier versions without deleting existing audit history.
        with EXCEL_LOCK:
            wb = load_workbook(EXCEL_FILE)
            required = {
                "Jira API Call Log": ["Timestamp", "Frontend action", "Jira endpoint", "HTTP status", "Duration ms", "Result", "Notes"],
                "Button Click Log": ["Timestamp", "Button / Action", "Click ID", "Click number", "Outcome", "Block reason", "Frontend route", "API endpoint", "HTTP status", "Duration ms", "Test run ID"],
                "Button Click Summary": ["Button / Action", "Total clicks", "Accepted clicks", "Blocked clicks", "Backend calls", "Jira calls", "Pass count", "Fail count", "Notes"],
                "QA Test Cases": ["Test Case ID", "Area", "Scenario", "Test Type", "Priority", "Preconditions", "Steps", "Expected Result", "Actual Result", "Status", "Evidence / Defect ID", "Standard / Rationale"],
            }
            changed = False
            for name, headers in required.items():
                if name not in wb.sheetnames:
                    ws = wb.create_sheet(name)
                    ws.append(headers)
                    changed = True
            if "API Call Log" in wb.sheetnames and wb["API Call Log"].max_row == 1:
                wb["API Call Log"][1][0].value = "Timestamp"
            if changed:
                for ws in wb.worksheets:
                    style_sheet(ws)
                wb.save(EXCEL_FILE)
        return
    wb = Workbook()
    api = wb.active
    api.title = "API Call Log"
    api.append(["Timestamp", "Method", "Path", "Status", "Duration ms", "Frontend action", "Click ID", "Blocked", "Frontend duration ms", "Backend duration ms", "Jira duration ms", "Test case ID", "Environment", "Notes"])
    jira_log = wb.create_sheet("Jira API Call Log")
    jira_log.append(["Timestamp", "Frontend action", "Jira endpoint", "HTTP status", "Duration ms", "Result", "Notes"])
    clicks = wb.create_sheet("Button Click Log")
    clicks.append(["Timestamp", "Button / Action", "Click ID", "Click number", "Outcome", "Block reason", "Frontend route", "API endpoint", "HTTP status", "Duration ms", "Test run ID"])
    summary = wb.create_sheet("Button Click Summary")
    summary.append(["Button / Action", "Total clicks", "Accepted clicks", "Blocked clicks", "Backend calls", "Jira calls", "Pass count", "Fail count", "Notes"])
    qa = wb.create_sheet("QA Test Cases")
    qa.append(["Test Case ID", "Area", "Scenario", "Test Type", "Priority", "Preconditions", "Steps", "Expected Result", "Actual Result", "Status", "Evidence / Defect ID", "Standard / Rationale"])
    qa_rows = [
        ["UI-001", "UI", "Primary button is visible and usable", "UI / Functional", "High", "App loaded", "Locate button by accessible role/name and click", "Action starts once; user receives clear feedback", "", "Not Run", "", "Playwright user-visible testing and actionability"],
        ["UI-002", "UI", "Button is protected during an in-flight request", "Negative / Concurrency", "Critical", "API response delayed in test", "Click the same action repeatedly while pending", "Only one action request starts; extra clicks are recorded as blocked", "", "Not Run", "", "Duplicate-action protection and concurrency testing"],
        ["API-001", "API", "Valid request returns expected response", "API / Positive", "High", "Valid test credentials and authorized test Jira", "Send request once and verify status and schema", "Expected 2xx response and required fields", "", "Not Run", "", "API contract and functional validation"],
        ["API-002", "API", "Invalid credentials are handled safely", "API / Negative", "High", "Test-only invalid credential", "Submit invalid credentials", "Clear error; secret not logged; no credential persistence", "", "Not Run", "", "Security and negative testing"],
        ["API-003", "API", "Concurrent duplicate API requests are rejected", "API / Concurrency", "Critical", "Authorized test environment", "Send concurrent identical action requests", "One request proceeds; duplicate gets 409 and is logged", "", "Not Run", "", "OWASP API resource-consumption/rate-limit testing principles"],
        ["API-004", "API", "Request timing and status are logged", "Observability", "High", "Excel tracker writable", "Run a known test request", "Timestamp, endpoint, status, action and duration recorded", "", "Not Run", "", "ISTQB test logging and execution timing"],
        ["DATA-001", "Data", "Imported issues are not duplicated on repeat import", "Data Integrity", "High", "Seeded test project", "Import the same issues twice", "Rows update by issue key rather than duplicating", "", "Not Run", "", "Idempotency and data-integrity testing"],
        ["SEC-001", "Security", "Credentials and tokens are excluded from logs", "Security / Privacy", "Critical", "Test credentials", "Perform connection test and inspect logs/workbook", "No API token, password or request body appears in logs", "", "Not Run", "", "Sensitive-data minimization"],
        ["E2E-001", "End-to-end", "Connect, load projects, import and view issues", "E2E / Smoke", "High", "Dedicated Jira test project", "Run the user journey", "Projects and imported issues display correctly; timings recorded", "", "Not Run", "", "Playwright isolated tests and user-visible assertions"],
        ["ERR-001", "Resilience", "Jira timeout or server error is handled", "Negative / Resilience", "Medium", "Mock or controlled failing endpoint", "Simulate timeout / 5xx", "Action finishes safely, error shown, lock released", "", "Not Run", "", "Error-path and recovery testing"],
    ]
    for row in qa_rows:
        qa.append(row)
    docs = wb.create_sheet("Imported Jira Issues")
    docs.append(["Imported At", "Issue Key", "Project Key", "Summary", "Status", "Assignee", "Updated At", "Jira URL"])
    mapping = wb.create_sheet("Frontend Backend Map")
    mapping.append(["Frontend file", "Frontend function / action", "HTTP method", "API endpoint", "Backend handler", "Purpose"])
    mapping_rows = [
        ["frontend/src/App.jsx", "request() on Test connection", "POST", "/api/jira/test-connection", "test_connection()", "Verify Jira email and API token."],
        ["frontend/src/App.jsx", "loadProjects()", "POST", "/api/jira/projects", "get_projects()", "List Jira projects the account can access."],
        ["frontend/src/App.jsx", "fetchDocuments()", "POST", "/api/jira/fetch-documents", "fetch_documents()", "Fetch Jira issues and save/update local records."],
        ["frontend/src/App.jsx", "loadDocuments()", "GET", "/api/documents?limit=500", "documents()", "Load locally imported issues for the Documents page."],
        ["frontend/src/App.jsx", "topbar refresh button", "GET", "/api/documents?limit=500", "documents()", "Refresh the visible local issue list."],
        ["Browser / health check", "API status", "GET", "/api/health", "health()", "Check whether the local backend is running."],
        ["Browser / API docs", "Swagger UI", "GET", "/docs", "FastAPI generated docs", "Inspect and test endpoints locally."],
    ]
    for row in mapping_rows:
        mapping.append(row)
    for ws in wb.worksheets:
        style_sheet(ws)
    wb.save(EXCEL_FILE)

def append_excel(sheet_name, row):
    ensure_excel_tracker()
    with EXCEL_LOCK:
        wb = load_workbook(EXCEL_FILE)
        ws = wb[sheet_name]
        ws.append(row)
        style_sheet(ws)
        wb.save(EXCEL_FILE)

def log_api_call(method: str, path: str, status: int, duration_ms: float, frontend_action: str = "", click_id: str = "", blocked: bool = False):
    append_excel("API Call Log", [datetime.now().astimezone().isoformat(timespec="seconds"), method, path, status, round(duration_ms, 2), frontend_action, click_id, "Yes" if blocked else "No", "", round(duration_ms, 2), "", "", "Local", "No request body or credentials are recorded."])

def log_jira_api_call(action: str, endpoint: str, status: int, duration_ms: float):
    append_excel("Jira API Call Log", [datetime.now().astimezone().isoformat(timespec="seconds"), action, endpoint, status, round(duration_ms, 2), "Success" if 200 <= status < 400 else "Failed", "Endpoint only; credentials and request bodies are never logged."])


async def timed_jira_get(client: httpx.AsyncClient, endpoint: str, action: str, params=None):
    started = time.perf_counter()
    status = 0
    try:
        response = await client.get(endpoint, params=params)
        status = response.status_code
        return response
    finally:
        elapsed = (time.perf_counter() - started) * 1000
        try:
            log_jira_api_call(action, endpoint, status, elapsed)
        except Exception as exc:
            print(f"[Jira API audit log warning] {exc}")


def log_button_event(event: dict):
    append_excel("Button Click Log", [datetime.now().astimezone().isoformat(timespec="seconds"), event.get("button_name", "Unknown"), event.get("click_id", ""), event.get("click_number", 1), event.get("outcome", "accepted"), event.get("block_reason", ""), event.get("frontend_route", ""), event.get("api_endpoint", ""), event.get("http_status", ""), event.get("duration_ms", ""), event.get("test_run_id", "")])
    # Recalculate the summary from the detailed event log so blocked attempts are counted too.
    with EXCEL_LOCK:
        wb = load_workbook(EXCEL_FILE)
        ws = wb["Button Click Log"]
        by_click = {}
        for row in ws.iter_rows(min_row=2, values_only=True):
            name, click_id, outcome = row[1] or "Unknown", row[2] or "", row[4] or "accepted"
            identity = click_id or f"{name}:{row[0]}:{row[3]}"
            item = by_click.setdefault((name, identity), {"blocked": False, "accepted": False})
            if outcome == "blocked":
                item["blocked"] = True
            else:
                item["accepted"] = True
        counts = {}
        for (name, _identity), outcome_flags in by_click.items():
            item = counts.setdefault(name, {"total": 0, "accepted": 0, "blocked": 0})
            item["total"] += 1
            if outcome_flags["blocked"] and not outcome_flags["accepted"]:
                item["blocked"] += 1
            else:
                item["accepted"] += 1
        summary = wb["Button Click Summary"]
        if summary.max_row > 1:
            summary.delete_rows(2, summary.max_row - 1)
        for name, c in sorted(counts.items()):
            summary.append([name, c["total"], c["accepted"], c["blocked"], "See API Call Log", "See Jira endpoint trace", "", "", "Counts from Button Click Log"])
        style_sheet(summary)
        wb.save(EXCEL_FILE)

def log_imported_issues(records):
    ensure_excel_tracker()
    with EXCEL_LOCK:
        wb = load_workbook(EXCEL_FILE)
        ws = wb["Imported Jira Issues"]
        # Replace existing log rows for the issue keys in this fetch, so repeated imports do not duplicate them.
        issue_keys = {record["issue_key"] for record in records}
        for row_index in range(ws.max_row, 1, -1):
            if ws.cell(row_index, 2).value in issue_keys:
                ws.delete_rows(row_index, 1)
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        for record in records:
            ws.append([now, record["issue_key"], record["project_key"], record["summary"], record["status"], record["assignee"], record["updated_at"], record["browse_url"]])
        style_sheet(ws)
        wb.save(EXCEL_FILE)


def db():
    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with db() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS documents (
            issue_key TEXT PRIMARY KEY, project_key TEXT NOT NULL, summary TEXT NOT NULL,
            description TEXT DEFAULT '', status TEXT DEFAULT '', assignee TEXT DEFAULT '',
            updated_at TEXT DEFAULT '', browse_url TEXT DEFAULT '')""")


@asynccontextmanager
async def lifespan(app):
    init_db()
    try:
        ensure_excel_tracker()
        print(f"[Dude AI] API audit workbook: {EXCEL_FILE}")
    except Exception as exc:
        print(f"[Dude AI warning] Could not initialize Excel audit workbook: {exc}")
    yield

app = FastAPI(title="Dude AI API", description="Connect Jira and import project issues.", lifespan=lifespan)

@app.middleware("http")
async def record_api_call(request: Request, call_next):
    started = time.perf_counter()
    status_code = 500
    path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    action_key = request.headers.get("x-frontend-action", request.url.path)
    click_id = request.headers.get("x-click-id", "")
    guarded = request.method == "POST" and request.url.path in {"/api/jira/test-connection", "/api/jira/projects", "/api/jira/fetch-documents"}
    guard_key = request.url.path
    acquired = False
    try:
        if guarded:
            with ACTIVE_ACTIONS_LOCK:
                if guard_key in ACTIVE_ACTIONS:
                    status_code = 409
                    return JSONResponse(
                        {"detail": "Duplicate action blocked: a request for this action is already running."},
                        status_code=409,
                    )
                ACTIVE_ACTIONS.add(guard_key)
                acquired = True
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        elapsed = (time.perf_counter() - started) * 1000
        if acquired:
            with ACTIVE_ACTIONS_LOCK:
                ACTIVE_ACTIONS.discard(guard_key)
        if path.startswith("/api/") and request.url.path != "/api/telemetry/button-event":
            try:
                log_api_call(request.method, path, status_code, elapsed, action_key, click_id, status_code == 409)
                # Record backend-side duplicate rejections in the click log as well,
                # including requests that bypass the React frontend guard.
                if guarded and status_code == 409:
                    log_button_event({
                        "button_name": action_key or request.url.path,
                        "click_id": click_id or f"backend-blocked-{time.time_ns()}",
                        "click_number": 0,
                        "outcome": "blocked",
                        "block_reason": "Backend rejected overlapping request (HTTP 409).",
                        "frontend_route": request.headers.get("referer", ""),
                        "api_endpoint": request.url.path,
                        "http_status": 409,
                        "duration_ms": round(elapsed, 2),
                        "test_run_id": request.headers.get("x-test-run-id", "")
                    })
            except Exception as exc:
                print(f"[Excel audit log warning] {exc}")

# Configure CORS origins for Vercel production, preview deployments, Render, and local dev
configured_origins = [
    "https://dude-ai-roan.vercel.app",
    "https://dudeai.onrender.com",
    "https://dude-ai.vercel.app",
    "https://dude-k6fe00oce-supporticon.vercel.app",
    "https://dude-ai-git-main-supporticon.vercel.app",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]

env_origins = os.environ.get("ALLOWED_ORIGINS") or os.environ.get("CORS_ORIGINS", "")
if env_origins:
    for origin in env_origins.split(","):
        cleaned = origin.strip().rstrip("/")
        if cleaned and cleaned not in configured_origins:
            configured_origins.append(cleaned)

# Added outermost so that all responses (including 409 rejections) contain CORS headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins,
    allow_origin_regex=r"^https:\/\/(dude-[a-zA-Z0-9_-]+|dudeai[a-zA-Z0-9_-]*)\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)



class ButtonEvent(BaseModel):
    button_name: str
    click_id: str = ""
    click_number: int = 1
    outcome: str = "accepted"
    block_reason: str = ""
    frontend_route: str = ""
    api_endpoint: str = ""
    http_status: int | str = ""
    duration_ms: float | str = ""
    test_run_id: str = ""


@app.post("/api/telemetry/button-event")
def button_event(body: ButtonEvent):
    log_button_event(body.model_dump())
    return {"success": True}


class Credentials(BaseModel):
    base_url: HttpUrl
    email: str = Field(min_length=3)
    api_token: str = Field(min_length=1)


class FetchRequest(Credentials):
    project_key: str = Field(min_length=1, max_length=30)
    max_results: int = Field(default=100, ge=1, le=100)


class SearchRequest(BaseModel):
    q: str = ""
    project_key: str | None = None


def clean_url(value: str) -> str:
    value = value.rstrip("/")
    parsed = urlparse(value)
    if not parsed.netloc or not parsed.scheme.startswith("http"):
        raise HTTPException(400, "Enter a valid Jira site URL, for example https://your-site.atlassian.net")
    return value


def jira_client(body: Credentials):
    return httpx.AsyncClient(base_url=clean_url(str(body.base_url)), auth=(body.email, body.api_token),
                             headers={"Accept": "application/json"}, timeout=30.0)


def jira_error(response: httpx.Response, action: str):
    if response.status_code == 401:
        detail = "Jira rejected the email or API token. Check both credentials."
    elif response.status_code == 403:
        detail = "Your Jira account does not have permission to perform this action."
    elif response.status_code == 410:
        detail = f"Jira returned HTTP 410 for {action}. Check that the current Jira REST endpoint is being used."
    else:
        detail = f"Jira {action} failed with HTTP {response.status_code}: {response.text[:300]}"
    raise HTTPException(response.status_code if response.status_code < 500 else 502, detail)


def to_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(filter(None, (to_text(item) for item in value)))
    if isinstance(value, dict):
        if value.get("type") == "text":
            return value.get("text", "")
        return " ".join(filter(None, (to_text(v) for k, v in value.items() if k not in {"type", "version"})))
    return str(value)


@app.get("/")
def home():
    return {"app": "Dude AI", "status": "running", "docs": "/docs"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/jira/test-connection")
async def test_connection(body: Credentials):
    async with jira_client(body) as client:
        response = await timed_jira_get(client, "/rest/api/3/myself", "Test connection")
    if response.is_error:
        jira_error(response, "connection test")
    user = response.json()
    return {"success": True, "display_name": user.get("displayName", body.email), "message": "Connected successfully"}


@app.post("/api/jira/projects")
async def get_projects(body: Credentials):
    projects, start_at = [], 0
    async with jira_client(body) as client:
        while True:
            response = await timed_jira_get(client, "/rest/api/3/project/search", "Load projects", params={"startAt": start_at, "maxResults": 50, "orderBy": "name"})
            if response.is_error:
                jira_error(response, "project list")
            data = response.json()
            values = data.get("values", [])
            projects.extend({"id": str(p.get("id", "")), "key": p.get("key", ""), "name": p.get("name", ""), "project_type": p.get("projectTypeKey", "") } for p in values)
            start_at += len(values)
            if not values or start_at >= data.get("total", 0):
                break
    return {"success": True, "count": len(projects), "projects": projects}


@app.post("/api/jira/fetch-documents")
async def fetch_documents(body: FetchRequest):
    project_key = body.project_key.strip().upper()
    jql = f'project = "{project_key}" ORDER BY updated DESC'
    fields = "summary,description,status,assignee,project,updated"
    issues, next_page_token = [], None
    async with jira_client(body) as client:
        # Jira Cloud's current enhanced JQL search endpoint is /search/jql.
        while len(issues) < body.max_results:
            params = {"jql": jql, "maxResults": min(100, body.max_results - len(issues)), "fields": fields}
            if next_page_token:
                params["nextPageToken"] = next_page_token
            response = await timed_jira_get(client, "/rest/api/3/search/jql", "Fetch documents", params=params)
            if response.is_error:
                jira_error(response, "issue search")
            data = response.json()
            batch = data.get("issues", [])
            issues.extend(batch)
            next_page_token = data.get("nextPageToken")
            if data.get("isLast", True) or not next_page_token or not batch:
                break
    records = []
    for issue in issues:
        fields_data = issue.get("fields") or {}
        status = fields_data.get("status") or {}
        assignee = fields_data.get("assignee") or {}
        records.append({
            "issue_key": issue.get("key", ""), "project_key": project_key,
            "summary": fields_data.get("summary") or "(No summary)",
            "description": to_text(fields_data.get("description")),
            "status": status.get("name", ""), "assignee": assignee.get("displayName", "Unassigned"),
            "updated_at": fields_data.get("updated", ""),
            "browse_url": f"{clean_url(str(body.base_url))}/browse/{issue.get('key', '')}"
        })
    with db() as con:
        con.executemany("""INSERT INTO documents(issue_key, project_key, summary, description, status, assignee, updated_at, browse_url)
            VALUES(:issue_key,:project_key,:summary,:description,:status,:assignee,:updated_at,:browse_url)
            ON CONFLICT(issue_key) DO UPDATE SET project_key=excluded.project_key, summary=excluded.summary,
            description=excluded.description, status=excluded.status, assignee=excluded.assignee,
            updated_at=excluded.updated_at, browse_url=excluded.browse_url""", records)
    log_imported_issues(records)
    print("\n" + "=" * 100)
    print(f"[Dude AI] Imported {len(records)} Jira issue(s) from project {project_key}")
    print(f"{'ISSUE KEY':<14} {'STATUS':<18} {'ASSIGNEE':<24} SUMMARY")
    print("-" * 100)
    for record in records:
        print(f"{record['issue_key']:<14} {record['status'][:17]:<18} {record['assignee'][:23]:<24} {record['summary']}")
    print(f"Excel tracker updated: {EXCEL_FILE}")
    print("=" * 100 + "\n")
    return {"success": True, "project_key": project_key, "fetched": len(records), "message": f"Imported {len(records)} issue(s)."}


@app.get("/api/documents")
def documents(project_key: str | None = None, q: str = Query(default="", max_length=200), limit: int = Query(default=500, ge=1, le=500)):
    sql = "SELECT * FROM documents WHERE 1=1"
    args = []
    if project_key:
        sql += " AND project_key = ?"
        args.append(project_key.upper())
    if q.strip():
        sql += " AND (issue_key LIKE ? OR summary LIKE ? OR description LIKE ? OR status LIKE ?)"
        args.extend([f"%{q}%"] * 4)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    args.append(limit)
    with db() as con:
        rows = [dict(row) for row in con.execute(sql, args).fetchall()]
    return {"count": len(rows), "documents": rows}


@app.get("/api/stats")
def stats():
    with db() as con:
        count = con.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        projects = con.execute("SELECT COUNT(DISTINCT project_key) FROM documents").fetchone()[0]
    return {"documents": count, "projects": projects}


@app.delete("/api/documents/{project_key}")
def delete_project(project_key: str):
    with db() as con:
        cursor = con.execute("DELETE FROM documents WHERE project_key = ?", (project_key.upper(),))
    return {"success": True, "deleted": cursor.rowcount, "project_key": project_key.upper()}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
