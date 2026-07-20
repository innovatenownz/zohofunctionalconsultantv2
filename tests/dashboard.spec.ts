import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.use({ baseURL: 'http://localhost:3000' });

  test('loads the dashboard with project list or empty state and create control', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Client Projects' })).toBeVisible();

    const projectCards = page.locator('a.card');
    const emptyState = page.getByText('No projects found matching the criteria.');

    await expect(projectCards.first().or(emptyState)).toBeVisible();

    await expect(page.getByRole('button', { name: 'New Project' })).toBeVisible();
  });
});
