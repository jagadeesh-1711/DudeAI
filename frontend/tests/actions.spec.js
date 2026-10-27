import { test, expect } from '@playwright/test';

const validProjects = { success: true, count: 1, projects: [{ id: '1', key: 'DEMO', name: 'Demo Project', project_type: 'software' }] };

test('connection button sends only one request while the request is pending', async ({ page }) => {
  let connectionCalls = 0;
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
