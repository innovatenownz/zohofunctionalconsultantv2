import { test, expect } from '@playwright/test';
import { getUnionMcpServerNames } from '../src/lib/mcp-server-names';
import { isMcpServerFullyRemoved } from '../src/lib/mcp-server-registry';

test.describe('getUnionMcpServerNames', () => {
  test('merges mcpConfig, enabled, and credential names without duplicates', () => {
    const names = getUnionMcpServerNames(
      {
        mcpServers: {
          'Innovate Now CRM': { url: 'https://example.com/a' },
          'MCP connection 2': { mcpServers: {} },
        },
      },
      ['Innovate Now CRM', 'MCP connection 2', 'orphan-enabled'],
      ['Innovate Now CRM', 'credential-only']
    );

    expect(names).toEqual([
      'credential-only',
      'Innovate Now CRM',
      'MCP connection 2',
      'orphan-enabled',
    ]);
  });

  test('returns empty array when nothing is configured', () => {
    expect(getUnionMcpServerNames({}, [], [])).toEqual([]);
  });
});

test.describe('isMcpServerFullyRemoved', () => {
  test('returns true when config and enabled entries were removed without errors', () => {
    expect(
      isMcpServerFullyRemoved({
        serverName: 'A',
        removedFromCredentials: false,
        removedFromMcpConfig: true,
        removedFromEnabledList: true,
        errors: [],
      })
    ).toBe(true);
  });

  test('returns false when nothing was removed', () => {
    expect(
      isMcpServerFullyRemoved({
        serverName: 'A',
        removedFromCredentials: false,
        removedFromMcpConfig: false,
        removedFromEnabledList: false,
        errors: [],
      })
    ).toBe(false);
  });
});
