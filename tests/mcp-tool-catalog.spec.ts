import { test, expect } from '@playwright/test';
import {
  COMPACT_DESCRIPTION_MAX_CHARS,
  HISTORY_MSG_CAP_GENERIC,
  HISTORY_MSG_CAP_GET_TOOL_SCHEMA,
  HISTORY_MSG_CAP_LIST_TOOLS,
  PERSISTED_RESULT_CAP_GENERIC,
  PERSISTED_RESULT_CAP_GET_TOOL_SCHEMA,
  PERSISTED_RESULT_CAP_LIST_TOOLS,
  capPersistedResultJson,
  historyMsgCapForContent,
  persistedResultCapForAction,
  resolveToolSchemaLookup,
  toCompactToolCatalog,
  toCompactToolDescription,
  truncateHistoryContent,
  truncatedPersistedResultSuffix,
} from '../src/lib/mcp-tool-catalog';
import { evaluateMcpCommandBeforeExecute } from '../src/lib/mcp-server-disambiguation';
import { interpretMcpToolResult } from '../src/lib/mcp-tool-result';
import { deriveToolResultChrome } from '../src/lib/mcp-tool-result-chrome';

const SAMPLE_TOOLS = [
  {
    name: 'ZohoCRM_createModules',
    description:
      'Creates a single custom module in the CRM. Permission requirement depends on access_type: Crm_Implied_Customize_Zoho_CRM for org_based (or when access_type is omitted), and Crm_Implied_Create_Team_Module for team_based. This operation is not idempotent.',
    serverName: 'Innovate Now CRM',
    inputSchema: {
      type: 'object',
      required: ['body'],
      properties: {
        body: {
          type: 'object',
          required: ['modules'],
          properties: {
            modules: { type: 'array' },
          },
        },
      },
    },
    outputSchema: { type: 'object' },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'ZohoCRM_getProfiles',
    description: 'Retrieves the list of CRM profiles with metadata.',
    serverName: 'Innovate Now CRM',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
  },
  {
    name: 'ZohoCRM_createModules',
    description: 'Creates a single custom module in the CRM.',
    serverName: 'Other CRM',
    inputSchema: { type: 'object', properties: { body: { type: 'object' } } },
  },
];

test.describe('toCompactToolDescription / toCompactToolCatalog', () => {
  test('truncates long descriptions to 120 chars with ellipsis', () => {
    const long = 'A'.repeat(200);
    const compact = toCompactToolDescription(long);
    expect(compact.length).toBe(COMPACT_DESCRIPTION_MAX_CHARS);
    expect(compact.endsWith('…')).toBe(true);
  });

  test('collapses whitespace to one line', () => {
    expect(toCompactToolDescription('line1\n\n  line2')).toBe('line1 line2');
  });

  test('compact catalog omits schemas/annotations and keeps name/description/serverName', () => {
    const catalog = toCompactToolCatalog(SAMPLE_TOOLS);
    expect(catalog).toHaveLength(3);
    expect(catalog[0]).toEqual({
      name: 'ZohoCRM_createModules',
      description: toCompactToolDescription(SAMPLE_TOOLS[0].description),
      serverName: 'Innovate Now CRM',
    });
    expect(catalog[0]).not.toHaveProperty('inputSchema');
    expect(catalog[0]).not.toHaveProperty('outputSchema');
    expect(catalog[0]).not.toHaveProperty('annotations');
  });

  test('compact catalog for 128 synthetic tools stays under list_tools persistence cap', () => {
    const tools = Array.from({ length: 128 }, (_, i) => ({
      name: `ZohoCRM_tool_${i}`,
      description: 'Creates a single custom module in the CRM. Permission requirement depends on access_type and more detail here to pad.',
      serverName: 'Innovate Now CRM',
      inputSchema: { type: 'object', properties: { body: { type: 'object' } } },
      outputSchema: { type: 'object' },
      annotations: { readOnlyHint: false },
    }));
    const compact = { tools: toCompactToolCatalog(tools) };
    const pretty = JSON.stringify(compact, null, 2);
    expect(pretty.length).toBeLessThan(PERSISTED_RESULT_CAP_LIST_TOOLS);
    expect(pretty.length).toBeGreaterThan(10_000);
    expect(pretty).not.toContain('inputSchema');
  });
});

test.describe('resolveToolSchemaLookup', () => {
  test('success returns lean tool with full inputSchema', () => {
    const result = resolveToolSchemaLookup(SAMPLE_TOOLS, 'ZohoCRM_getProfiles', 'Innovate Now CRM');
    expect(result).toEqual({
      tool: {
        name: 'ZohoCRM_getProfiles',
        description: 'Retrieves the list of CRM profiles with metadata.',
        serverName: 'Innovate Now CRM',
        inputSchema: { type: 'object', properties: {} },
      },
    });
    expect(result).not.toHaveProperty('isError');
    if ('tool' in result) {
      expect(result.tool).not.toHaveProperty('outputSchema');
      expect(result.tool).not.toHaveProperty('annotations');
    }
  });

  test('SCHEMA_LOOKUP_INVALID when toolName missing', () => {
    expect(resolveToolSchemaLookup(SAMPLE_TOOLS, undefined)).toEqual({
      error: 'Missing toolName',
      code: 'SCHEMA_LOOKUP_INVALID',
      isError: true,
    });
    expect(resolveToolSchemaLookup(SAMPLE_TOOLS, '   ')).toEqual({
      error: 'Missing toolName',
      code: 'SCHEMA_LOOKUP_INVALID',
      isError: true,
    });
  });

  test('SCHEMA_LOOKUP_NOT_FOUND when tool absent', () => {
    expect(resolveToolSchemaLookup(SAMPLE_TOOLS, 'ZohoCRM_nope', 'Innovate Now CRM')).toEqual({
      error: 'Tool not found: ZohoCRM_nope',
      code: 'SCHEMA_LOOKUP_NOT_FOUND',
      matchingServerNames: [],
      isError: true,
    });
  });

  test('SCHEMA_LOOKUP_AMBIGUOUS when same tool on multiple servers without serverName', () => {
    expect(resolveToolSchemaLookup(SAMPLE_TOOLS, 'ZohoCRM_createModules')).toEqual({
      error: 'Tool ZohoCRM_createModules exists on multiple connections; specify serverName',
      code: 'SCHEMA_LOOKUP_AMBIGUOUS',
      matchingServerNames: ['Innovate Now CRM', 'Other CRM'],
      isError: true,
    });
  });

  test('serverName disambiguates multi-server tool', () => {
    const result = resolveToolSchemaLookup(
      SAMPLE_TOOLS,
      'ZohoCRM_createModules',
      'Other CRM'
    );
    expect('tool' in result).toBe(true);
    if ('tool' in result) {
      expect(result.tool.serverName).toBe('Other CRM');
    }
  });
});

test.describe('persisted / history caps', () => {
  test('persistedResultCapForAction returns designed caps', () => {
    expect(persistedResultCapForAction('list_tools')).toBe(PERSISTED_RESULT_CAP_LIST_TOOLS);
    expect(persistedResultCapForAction('get_tool_schema')).toBe(PERSISTED_RESULT_CAP_GET_TOOL_SCHEMA);
    expect(persistedResultCapForAction('ZohoCRM_createModules')).toBe(PERSISTED_RESULT_CAP_GENERIC);
  });

  test('capPersistedResultJson leaves short payloads intact', () => {
    expect(capPersistedResultJson('ZohoCRM_getProfiles', '{"ok":true}')).toBe('{"ok":true}');
  });

  test('capPersistedResultJson uses generic truncation suffix', () => {
    const big = 'x'.repeat(2500);
    const capped = capPersistedResultJson('ZohoCRM_createModules', big);
    expect(capped.length).toBeGreaterThan(PERSISTED_RESULT_CAP_GENERIC);
    expect(capped.startsWith('x'.repeat(PERSISTED_RESULT_CAP_GENERIC))).toBe(true);
    expect(capped).toContain(truncatedPersistedResultSuffix('ZohoCRM_createModules', 2500).trim());
  });

  test('capPersistedResultJson uses stronger schema truncation hint', () => {
    const big = 's'.repeat(PERSISTED_RESULT_CAP_GET_TOOL_SCHEMA + 500);
    const capped = capPersistedResultJson('get_tool_schema', big);
    expect(capped).toContain('truncated tool schema');
    expect(capped).toContain('re-call get_tool_schema is not enough if truncated');
    expect(capped).toContain('Full output is in Developer Details');
  });

  test('historyMsgCapForContent detects list_tools and get_tool_schema messages', () => {
    const listMsg =
      'Listing tools.\n\n```mcp-command\n{\n  "action": "list_tools"\n}\n```\n\n**✅**\n```json\n{"tools":[]}\n```';
    const schemaMsg =
      'Looking up schema.\n\n```mcp-command\n{\n  "action": "get_tool_schema",\n  "toolName": "ZohoCRM_createModules"\n}\n```\n\n```json\n{"tool":{"inputSchema":{}}}\n```';
    expect(historyMsgCapForContent(listMsg)).toBe(HISTORY_MSG_CAP_LIST_TOOLS);
    expect(historyMsgCapForContent(schemaMsg)).toBe(HISTORY_MSG_CAP_GET_TOOL_SCHEMA);
    expect(historyMsgCapForContent('normal agent reply')).toBe(HISTORY_MSG_CAP_GENERIC);
  });

  test('truncateHistoryContent preserves compact catalog under list_tools cap', () => {
    const catalogJson = JSON.stringify(
      { tools: toCompactToolCatalog(Array.from({ length: 128 }, (_, i) => ({
        name: `T_${i}`,
        description: 'Short description for catalog entry used in history truncation test.',
        serverName: 'Innovate Now CRM',
      }))) },
      null,
      2
    );
    const msg =
      '```mcp-command\n{\n  "action": "list_tools"\n}\n```\n\n```json\n' + catalogJson + '\n```';
    expect(msg.length).toBeGreaterThan(HISTORY_MSG_CAP_GENERIC);
    expect(msg.length).toBeLessThan(HISTORY_MSG_CAP_LIST_TOOLS);
    expect(truncateHistoryContent(msg)).toBe(msg);
  });
});

test.describe('disambiguation skip for get_tool_schema', () => {
  test('get_tool_schema bypasses listAllMCPTools like list_tools', async () => {
    let listToolsCalled = false;
    const mockListTools = async () => {
      listToolsCalled = true;
      return [];
    };

    const multi = {
      mcpServers: {
        a: { url: 'https://mcp.example/a' },
        b: { url: 'https://mcp.example/b' },
      },
    };

    const decision = await evaluateMcpCommandBeforeExecute(
      multi,
      { action: 'get_tool_schema', toolName: 'ZohoCRM_createModules' },
      'project-1',
      mockListTools
    );

    expect(listToolsCalled).toBe(false);
    expect(decision.execute).toBe(true);
    if (decision.execute) {
      expect(decision.command).toEqual({
        action: 'get_tool_schema',
        toolName: 'ZohoCRM_createModules',
      });
    }
  });
});

test.describe('schema lookup result interpretation + chrome', () => {
  test('interpretMcpToolResult treats SCHEMA_LOOKUP_* as failure', () => {
    const r = interpretMcpToolResult({
      error: 'Missing toolName',
      code: 'SCHEMA_LOOKUP_INVALID',
      isError: true,
    });
    expect(r.ok).toBe(false);
    expect(r.errorSummary).toContain('SCHEMA_LOOKUP_INVALID');
  });

  test('interpretMcpToolResult treats lean schema success as ok', () => {
    const r = interpretMcpToolResult({
      tool: {
        name: 'ZohoCRM_createModules',
        description: 'Creates a module',
        serverName: 'Innovate Now CRM',
        inputSchema: { type: 'object' },
      },
    });
    expect(r.ok).toBe(true);
  });

  test('deriveToolResultChrome titles get_tool_schema', () => {
    const chrome = deriveToolResultChrome(
      { tool: { name: 'x', inputSchema: {} } },
      { action: 'get_tool_schema' }
    );
    expect(chrome.title).toBe('MCP Connections: Tool Schema');
    expect(chrome.isToolError).toBe(false);
  });
});
