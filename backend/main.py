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