import { test, expect } from '@playwright/test';

test.describe('On-Demand MCP Authentication Flow', () => {
  // Use the existing running local server
  test.use({ baseURL: 'http://localhost:3000' });

  test('should display Authorize & Connect button and redirect correctly', async ({ page, request }) => {
    // Dynamically create a temporary project via API for the test
    const projectRes = await request.post('/api/projects', {
      data: {
        name: 'Playwright Test Project',
        description: 'Created during Playwright E2E test runs',
        mcpConfig: { mcpServers: {} }
      }
    });
    expect(projectRes.ok()).toBeTruthy();
    const { project } = await projectRes.json();
    const projectId = project.id;

    // Navigate to the dynamic project page
    await page.goto(`/project/${projectId}`);
    // Wait for the page to be ready
    await page.waitForLoadState('domcontentloaded');

    // Switch to Settings tab first
    await page.click('text="Settings & Context"');

    // Open the Add Server modal
    await page.click('text="+ Add Server"');

    // Fill in basic server details
    await page.fill('input[placeholder*="zoho-crm"]', 'zoho-test');
    await page.fill('input[placeholder*="crm-mcp.zoho.com"]', 'https://example.zoho.com');

    // The "Authorize & Connect via OAuth" button should be visible
    const connectButton = page.getByRole('button', { name: /Authorize & Connect via OAuth/i });
    await expect(connectButton).toBeVisible();

    // We can intercept the network request to /oauth/initiate to prevent actual navigation during the test
    // or just listen for the popup/navigation
    await page.route('**/api/projects/*/oauth/initiate', async route => {
      // Mock the response so we don't actually hit Zoho's servers during an automated test
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://mcp.zoho.com.au/mock-oauth-url' })
      });
    });

    // Click the connect button
    await connectButton.click();

    // Because it returns a mock URL, the page should navigate or popup to our mock URL.
    // If it opens a popup:
    // const [popup] = await Promise.all([
    //   page.waitForEvent('popup'),
    //   connectButton.click()
    // ]);
    // await expect(popup).toHaveURL(/mock-oauth-url/);

    // If it's a direct navigation, we wait for the URL to change
    await page.waitForURL('**/mock-oauth-url');
    
    expect(page.url()).toContain('mock-oauth-url');
  });
});
