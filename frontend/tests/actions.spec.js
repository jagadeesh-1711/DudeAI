import { test, expect } from '@playwright/test';

const validProjects = { success: true, count: 1, projects: [{ id: '1', key: 'DEMO', name: 'Demo Project', project_type: 'software' }] };

test('displays welcome modal on open, validates required fields, and greets user upon submission', async ({ page }) => {
  await page.route('**/api/telemetry/button-event', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  await page.route('**/api/documents?limit=500', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"documents":[]}' }));

  await page.goto('/');

  // 1. Verify exact welcome message and labels
  await expect(page.getByText('Hello! Welcome to Dude AI. Before we get started, please share your details.')).toBeVisible();
  await expect(page.getByLabel(/What should we call you\?/i)).toBeVisible();
  await expect(page.getByLabel(/What is your User ID\?/i)).toBeVisible();

  const startBtn = page.getByRole('button', { name: /Let's Get Started/i });
  await expect(startBtn).toBeVisible();

  // 2. Validate empty submission is blocked
  await startBtn.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/Please fill in both fields before continuing/i)).toBeVisible();

  // 3. Fill in username and user ID
  await page.getByLabel(/What should we call you\?/i).fill('Alex Hunter');
  await page.getByLabel(/What is your User ID\?/i).fill('USR-1042');
  await startBtn.click();

  // 4. Modal is dismissed and personalized greeting appears
  await expect(page.getByText(/Welcome, Alex Hunter!/i)).toBeVisible();
  await expect(page.getByText('Hello! Welcome to Dude AI. Before we get started, please share your details.')).not.toBeVisible();

  // 5. User badge displays in topbar
  await expect(page.getByRole('button', { name: /Alex Hunter/i })).toBeVisible();
  await expect(page.getByText('(USR-1042)')).toBeVisible();
});

test('passes user identity headers and credentials to backend Jira connection', async ({ page }) => {
  let capturedHeaders = null;
  let capturedBody = null;

  await page.route('**/api/telemetry/button-event', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  await page.route('**/api/documents?limit=500', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"documents":[]}' }));
  await page.route('**/api/jira/test-connection', async route => {
    capturedHeaders = route.request().headers();
    capturedBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        display_name: 'Alex Cloud',
        jira_account_id: 'jira-acc-777',
        identity_status: {
          user_name: 'Alex Hunter',
          user_id: 'USR-1042',
          status: 'internal_application_id',
          verified_jira_account: false,
          jira_account_id: 'jira-acc-777',
          jira_display_name: 'Alex Cloud',
          message: "User ID 'USR-1042' is recorded as an internal application ID. It does not match the authenticated Jira account ID (jira-acc...)."
        },
        message: 'Connected successfully'
      })
    });
  });

  // Pre-seed user identity
  await page.addInitScript(() => {
    window.localStorage.setItem('dude_ai_user', JSON.stringify({ username: 'Alex Hunter', userId: 'USR-1042' }));
  });

  await page.goto('/');
  await page.getByLabel(/Jira base URL/i).fill('https://example.atlassian.net');
  await page.getByLabel(/Account email/i).fill('alex@example.com');
  await page.getByLabel(/API token/i).fill('test-secret-token');

  await page.getByRole('button', { name: /Test connection/i }).click();

  // Verify headers and payload
  await expect.poll(() => capturedHeaders?.['x-user-name']).toBe('Alex Hunter');
  await expect.poll(() => capturedHeaders?.['x-user-id']).toBe('USR-1042');
  expect(capturedBody?.user_name).toBe('Alex Hunter');
  expect(capturedBody?.user_id).toBe('USR-1042');

  // Verify non-misleading Jira verification banner
  await expect(page.getByText(/Active User & Jira Identity/i)).toBeVisible();
  await expect(page.locator('.identity-note')).toBeVisible();
  await expect(page.locator('.identity-note')).toContainText('internal application ID');
});

test('connection button sends only one request while the request is pending', async ({ page }) => {
  let connectionCalls = 0;
  await page.addInitScript(() => {
    window.localStorage.setItem('dude_ai_user', JSON.stringify({ username: 'QA Tester', userId: 'USR-QA' }));
  });
  await page.route('**/api/telemetry/button-event', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  await page.route('**/api/jira/test-connection', async route => {
    connectionCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 900));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, display_name: 'QA Test' }) });
  });
  await page.goto('/');
  await page.getByLabel(/Jira base URL/i).fill('https://example.atlassian.net');
  await page.getByLabel(/Account email/i).fill('qa@example.com');
  await page.getByLabel(/API token/i).fill('test-only-token');
  const button = page.getByRole('button', { name: /Test connection/i });
  await button.click();
  await button.click();
  await expect(page.getByText(/Click blocked/i)).toBeVisible();
  await expect.poll(() => connectionCalls).toBe(1);
});

test('projects can be loaded and a project is displayed', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dude_ai_user', JSON.stringify({ username: 'QA Tester', userId: 'USR-QA' }));
  });
  await page.route('**/api/telemetry/button-event', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  await page.route('**/api/jira/projects', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(validProjects) }));
  await page.goto('/');
  await page.getByLabel(/Jira base URL/i).fill('https://example.atlassian.net');
  await page.getByLabel(/Account email/i).fill('qa@example.com');
  await page.getByLabel(/API token/i).fill('test-only-token');
  await page.getByRole('button', { name: /Load projects/i }).click();
  await expect(page.getByText('Demo Project')).toBeVisible();
  await expect(page.getByRole('button', { name: /Fetch documents/i })).toBeVisible();
});

test('fetch action reports a backend error without crashing the UI', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dude_ai_user', JSON.stringify({ username: 'QA Tester', userId: 'USR-QA' }));
  });
  await page.route('**/api/telemetry/button-event', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  await page.route('**/api/jira/projects', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(validProjects) }));
  await page.route('**/api/jira/fetch-documents', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ detail: 'Simulated Jira error for test' }) }));
  await page.goto('/');
  await page.getByLabel(/Jira base URL/i).fill('https://example.atlassian.net');
  await page.getByLabel(/Account email/i).fill('qa@example.com');
  await page.getByLabel(/API token/i).fill('test-only-token');
  await page.getByRole('button', { name: /Load projects/i }).click();
  await page.getByRole('button', { name: /Fetch documents/i }).click();
  await expect(page.getByText('Simulated Jira error for test')).toBeVisible();
});

test('download excel report button requests /api/reports/excel and provides feedback', async ({ page }) => {
  let reportCalls = 0;
  await page.addInitScript(() => {
    window.localStorage.setItem('dude_ai_user', JSON.stringify({ username: 'QA Tester', userId: 'USR-QA' }));
  });
  await page.route('**/api/telemetry/button-event', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  await page.route('**/api/reports/excel', async route => {
    reportCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: { 'Content-Disposition': 'attachment; filename="api_audit_tracker.xlsx"' },
      body: 'mock-excel-binary-data',
    });
  });
  await page.goto('/');
  const downloadButton = page.getByRole('button', { name: /Download Excel Report/i }).first();
  await expect(downloadButton).toBeVisible();
  await downloadButton.click();
  await expect(page.getByText(/downloaded successfully/i)).toBeVisible();
  await expect.poll(() => reportCalls).toBe(1);
});

test('vulnerability import modal previews security_vulnerabilities.json and imports mapped issues into Jira', async ({ page }) => {
  let importPayload = null;
  let importHeaders = null;

  await page.addInitScript(() => {
    window.localStorage.setItem('dude_ai_user', JSON.stringify({ username: 'Security Auditor', userId: 'SEC-99' }));
  });

  await page.route('**/api/telemetry/button-event', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  await page.route('**/api/documents?limit=500', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"documents":[]}' }));
  await page.route('**/api/jira/projects', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(validProjects) }));

  await page.route('**/api/jira/validate-import-json', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        valid: true,
        count: 6,
        welcome_message: 'Hello! 👋 Welcome to Dude AI Security Assistant. What would you like to check today?',
        user_instructions: 'Review the detected security findings below. You can select an individual vulnerability category or import all sample security issues into your connected Jira project.',
        selection_prompt: 'Select a vulnerability category to preview and import, or choose "All Categories" to import the full security test suite.',
        categories: [
          'Password Exposure',
          'User ID Information Disclosure',
          'Revenue Data Exposure',
          'Potential Malware',
          'Missing API Authorization',
          'Sensitive Data Leakage'
        ],
        detected_project_keys: ['DAST'],
        issues: [
          { index: 1, category: 'Password Exposure', summary: 'Password Exposure Vulnerability', issuetype: 'Bug', priority: 'Highest', severity: 'Critical', original_project_key: 'DAST', labels: ['security'], description_preview: 'Sample security finding...' },
          { index: 2, category: 'User ID Information Disclosure', summary: 'User ID Information Disclosure', issuetype: 'Bug', priority: 'High', severity: 'High', original_project_key: 'DAST', labels: ['security'], description_preview: 'Sample security finding...' },
          { index: 3, category: 'Revenue Data Exposure', summary: 'Revenue Data Exposure', issuetype: 'Bug', priority: 'High', severity: 'High', original_project_key: 'DAST', labels: ['security'], description_preview: 'Sample security finding...' },
          { index: 4, category: 'Potential Malware', summary: 'Potential Malware in Uploaded File', issuetype: 'Bug', priority: 'Highest', severity: 'Critical', original_project_key: 'DAST', labels: ['security'], description_preview: 'Sample security finding...' },
          { index: 5, category: 'Missing API Authorization', summary: 'Missing API Authorization', issuetype: 'Bug', priority: 'High', severity: 'High', original_project_key: 'DAST', labels: ['security'], description_preview: 'Sample security finding...' },
          { index: 6, category: 'Sensitive Data Leakage', summary: 'Sensitive Data Leakage in API Response', issuetype: 'Bug', priority: 'High', severity: 'Medium', original_project_key: 'DAST', labels: ['security'], description_preview: 'Sample security finding...' },
        ],
        message: 'Successfully validated 6 vulnerability issue(s).'
      })
    });
  });

  await page.route('**/api/jira/import-vulnerabilities', async route => {
    importHeaders = route.request().headers();
    importPayload = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        target_project_key: 'DEMO',
        total: 6,
        created: 6,
        skipped: 0,
        failed: 0,
        results: [
          { summary: 'Password Exposure Vulnerability', status: 'created', issue_key: 'DEMO-101', browse_url: 'https://example.atlassian.net/browse/DEMO-101' },
          { summary: 'User ID Information Disclosure', status: 'created', issue_key: 'DEMO-102', browse_url: 'https://example.atlassian.net/browse/DEMO-102' },
          { summary: 'Revenue Data Exposure', status: 'created', issue_key: 'DEMO-103', browse_url: 'https://example.atlassian.net/browse/DEMO-103' },
          { summary: 'Potential Malware in Uploaded File', status: 'created', issue_key: 'DEMO-104', browse_url: 'https://example.atlassian.net/browse/DEMO-104' },
          { summary: 'Missing API Authorization', status: 'created', issue_key: 'DEMO-105', browse_url: 'https://example.atlassian.net/browse/DEMO-105' },
          { summary: 'Sensitive Data Leakage in API Response', status: 'created', issue_key: 'DEMO-106', browse_url: 'https://example.atlassian.net/browse/DEMO-106' },
        ],
        message: 'Import completed: 6 created, 0 skipped, 0 failed.'
      })
    });
  });

  await page.goto('/');

  // 1. Enter Jira credentials
  await page.getByLabel(/Jira base URL/i).fill('https://example.atlassian.net');
  await page.getByLabel(/Account email/i).fill('auditor@example.com');
  await page.getByLabel(/API token/i).fill('auditor-token');

  // 2. Open Vulnerability Importer modal from topbar
  const openModalBtn = page.getByRole('button', { name: /Import Vulnerabilities/i }).first();
  await openModalBtn.click();

  await expect(page.getByText('Import Security Vulnerabilities to Jira')).toBeVisible();

  // Verify friendly assistant prompt is displayed
  await expect(page.getByText('Hello! 👋 Welcome to Dude AI Security Assistant')).toBeVisible();

  // 3. Click "Load Sample Vulnerabilities"
  const loadSampleBtn = page.getByRole('button', { name: /Load Sample Vulnerabilities/i });
  await loadSampleBtn.click();

  // Configure target project key
  await page.locator('#target-project-select').fill('DEMO');

  // 4. Verify preview table shows the 6 vulnerability items and category selector
  await expect(page.getByText('Previewing 6 Vulnerability Issue(s)')).toBeVisible();
  await expect(page.locator('#vuln-category-select')).toBeVisible();
  await expect(page.getByText('Password Exposure Vulnerability')).toBeVisible();
  await expect(page.getByText('Potential Malware in Uploaded File')).toBeVisible();
  await expect(page.getByText('Sensitive Data Leakage in API Response')).toBeVisible();

  // 5. Click Confirm & Import
  const confirmBtn = page.getByRole('button', { name: /Confirm & Import 6 Issues to Jira/i });
  await confirmBtn.click();

  // 6. Verify import results card
  await expect(page.getByText('Jira Import Results')).toBeVisible();
  await expect(page.getByText('Created in Jira')).toBeVisible();
  await expect(page.getByText('DEMO-101')).toBeVisible();
  await expect(page.getByText('DEMO-106')).toBeVisible();

  // 7. Verify sent headers and payload mapping
  await expect.poll(() => importHeaders?.['x-user-name']).toBe('Security Auditor');
  await expect.poll(() => importHeaders?.['x-user-id']).toBe('SEC-99');
  expect(importPayload?.target_project_key).toBe('DEMO');
  expect(importPayload?.issues?.length).toBe(6);
});

