"""Dude AI - simple Jira connection and issue importer for learning."""
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
