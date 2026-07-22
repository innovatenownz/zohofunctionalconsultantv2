import { test, expect } from '@playwright/test';

test.describe('MCP server delete API', () => {
  test.use({ baseURL: 'http://localhost:3000' });

  test('DELETE removes one URL server from mcpConfig and enabledMcpServers without affecting others', async ({
    request,
  }) => {
    const createRes = await request.post('/api/projects', {
      data: {
        name: 'MCP Delete Test Project',
        mcpConfig: {
          mcpServers: {
            'OAuth URL Server': { url: 'https://mcp.example.com/oauth-server' },
            'JSON Cred Server': { url: 'https://mcp.example.com/json-server' },
          },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { project: created } = await createRes.json();
    const projectId = created.id as string;

    await request.put(`/api/projects/${projectId}`, {
      data: {
        enabledMcpServers: ['OAuth URL Server', 'JSON Cred Server'],
      },
    });

    const deleteRes = await request.fetch(`/api/projects/${projectId}/credentials`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ serverName: 'OAuth URL Server' }),
    });
    expect(deleteRes.ok()).toBeTruthy();
    const deleteBody = await deleteRes.json();
    expect(deleteBody.success).toBe(true);
    expect(deleteBody.result.removedFromMcpConfig).toBe(true);
    expect(deleteBody.result.removedFromEnabledList).toBe(true);

    const getRes = await request.get(`/api/projects/${projectId}`);
    expect(getRes.ok()).toBeTruthy();
    const { project } = await getRes.json();

    expect(project.mcpConfig.mcpServers['OAuth URL Server']).toBeUndefined();
    expect(project.mcpConfig.mcpServers['JSON Cred Server']).toEqual({
      url: 'https://mcp.example.com/json-server',
    });
    expect(project.enabledMcpServers).toEqual(['JSON Cred Server']);
  });

  test('DELETE removes orphan enabled-only server without touching other servers', async ({
    request,
  }) => {
    const createRes = await request.post('/api/projects', {
      data: {
        name: 'MCP Orphan Delete Test',
        mcpConfig: {
          mcpServers: {
            'Keep Me': { url: 'https://mcp.example.com/keep' },
          },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { project: created } = await createRes.json();
    const projectId = created.id as string;

    await request.put(`/api/projects/${projectId}`, {
      data: {
        enabledMcpServers: ['Keep Me', 'Orphan Enabled Only'],
      },
    });

    const deleteRes = await request.fetch(`/api/projects/${projectId}/credentials`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ serverName: 'Orphan Enabled Only' }),
    });
    expect(deleteRes.ok()).toBeTruthy();
    const deleteBody = await deleteRes.json();
    expect(deleteBody.result.removedFromEnabledList).toBe(true);
    expect(deleteBody.result.removedFromMcpConfig).toBe(false);

    const getRes = await request.get(`/api/projects/${projectId}`);
    const { project } = await getRes.json();
    expect(project.enabledMcpServers).toEqual(['Keep Me']);
    expect(project.mcpConfig.mcpServers['Keep Me']).toBeDefined();
  });
});
