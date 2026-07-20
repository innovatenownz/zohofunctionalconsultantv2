import { test, expect } from '@playwright/test';

test.describe('Multi-Chat Session Support', () => {
  test.use({ baseURL: 'http://localhost:3000' });

  test('should support creating, renaming, and switching chat sessions', async ({ page, request }) => {
    // 1. Dynamically create a project via API for this test
    const projectRes = await request.post('/api/projects', {
      data: {
        name: 'Multi-Chat Test Project',
        description: 'Testing multiple chat threads',
        mcpConfig: { mcpServers: {} }
      }
    });
    expect(projectRes.ok()).toBeTruthy();
    const { project } = await projectRes.json();
    const projectId = project.id;

    // 2. Navigate to the project page
    await page.goto(`/project/${projectId}`);
    
    // 3. Verify a default chat session exists (wait for async load to populate option)
    const chatSelect = page.locator('select');
    await expect(chatSelect).toBeVisible();
    
    // Wait for the default session option to load
    await expect(chatSelect.locator('option')).toHaveCount(1);
    
    const initialOptions = await chatSelect.locator('option').allTextContents();
    expect(initialOptions[0]).toContain('Chat Session -');

    // 4. Create a new chat session
    const newChatBtn = page.getByRole('button', { name: /New Chat/i });
    await expect(newChatBtn).toBeVisible();
    await newChatBtn.click();

    // Verify a second option is added and selected
    await expect(chatSelect.locator('option')).toHaveCount(2);

    // 5. Rename the chat session
    const renameBtn = page.locator('button[title="Rename Chat Session"]');
    await expect(renameBtn).toBeVisible();
    await renameBtn.click();

    const renameInput = page.getByPlaceholder('New Chat Title');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Feature Discussion Chat');

    const saveBtn = page.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify option text changed
    await expect(chatSelect.locator('option')).toContainText(['Feature Discussion Chat']);

    // 6. Delete a chat session
    const deleteBtn = page.locator('button[title="Delete Chat Session"]');
    await expect(deleteBtn).toBeVisible();

    // Intercept confirm dialog
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to delete this chat session?');
      await dialog.accept();
    });

    await deleteBtn.click();

    // Verify we are back to 1 option
    await expect(chatSelect.locator('option')).toHaveCount(1);
  });
});
