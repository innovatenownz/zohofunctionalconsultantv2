import { test, expect } from '@playwright/test';
import { interpretMcpToolResult } from '../src/lib/mcp-tool-result';
import { deriveToolResultChrome, formatToolResultBoolean } from '../src/lib/mcp-tool-result-chrome';

/** Live capture: tool-not-found with isError false and structuredContent.status failure. */
const TOOL_NOT_FOUND_LIVE_FIXTURE = {
  content: [{ type: 'text', text: 'Tool not found: ZohoCRM_createModule' }],
  structuredContent: {
    status: 'failure',
    data: { message: 'Tool not found: ZohoCRM_createModule' },
  },
  isError: false,
};

test.describe('interpretMcpToolResult', () => {
  test('treats null / undefined / non-objects as success (no crash)', () => {
    expect(interpretMcpToolResult(null)).toEqual({ ok: true });
    expect(interpretMcpToolResult(undefined)).toEqual({ ok: true });
    expect(interpretMcpToolResult('string')).toEqual({ ok: true });
    expect(interpretMcpToolResult(42)).toEqual({ ok: true });
    expect(interpretMcpToolResult(true)).toEqual({ ok: true });
  });

  test('treats benign isError false / omitted payloads as success', () => {
    expect(interpretMcpToolResult({ content: [{ type: 'text', text: 'ok' }] })).toEqual({ ok: true });
    expect(interpretMcpToolResult({ isError: false, content: [] })).toEqual({ ok: true });
    expect(
      interpretMcpToolResult({
        isError: false,
        content: [{ type: 'text', text: 'Validation complete — 0 errors found in module schema' }],
      })
    ).toEqual({ ok: true });
  });

  test('detects live Tool-not-found fixture via structuredContent.status (tier 2)', () => {
    const result = interpretMcpToolResult(TOOL_NOT_FOUND_LIVE_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errorSummary).toContain('Tool not found: ZohoCRM_createModule');
  });

  test('detects isError true and summarizes from content text (tier 1)', () => {
    const result = interpretMcpToolResult({
      isError: true,
      content: [
        { type: 'text', text: 'MANDATORY_NOT_FOUND: profiles field is required' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errorSummary).toContain('MANDATORY_NOT_FOUND');
  });

  test('prefers structuredContent code/message when present (tier 1)', () => {
    const result = interpretMcpToolResult({
      isError: true,
      structuredContent: {
        code: 'MANDATORY_NOT_FOUND',
        message: 'Missing profile IDs',
      },
      content: [{ type: 'text', text: 'ignored when structured present' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errorSummary).toBe('MANDATORY_NOT_FOUND: Missing profile IDs');
  });

  test('reads structuredContent.data.message for summaries (tier 2)', () => {
    const result = interpretMcpToolResult({
      isError: false,
      structuredContent: {
        status: 'failure',
        data: { message: 'Tool not found: ZohoCRM_createFields' },
      },
      content: [{ type: 'text', text: 'Tool not found: ZohoCRM_createFields' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errorSummary).toContain('Tool not found: ZohoCRM_createFields');
  });

  test('caps errorSummary at ~200 characters', () => {
    const long = 'E'.repeat(500);
    const result = interpretMcpToolResult({
      isError: true,
      content: [{ type: 'text', text: long }],
    });
    expect(result.ok).toBe(false);
    expect(result.errorSummary!.length).toBeLessThanOrEqual(200);
    expect(result.errorSummary!.endsWith('…')).toBe(true);
  });

  test('falls back to generic summary when isError with empty content', () => {
    const result = interpretMcpToolResult({ isError: true, content: [] });
    expect(result.ok).toBe(false);
    expect(result.errorSummary).toMatch(/isError/i);
  });

  test('list_tools wrapper shape stays success', () => {
    expect(
      interpretMcpToolResult({
        tools: [{ name: 'ZohoCRM_getModules', serverName: 'ZohoMCP' }],
      })
    ).toEqual({ ok: true });
  });
});

test.describe('deriveToolResultChrome / formatToolResultBoolean (widget Part C)', () => {
  test('error payload uses failure badge and title (not Created Successfully)', () => {
    const chrome = deriveToolResultChrome(
      { isError: true, content: [{ type: 'text', text: 'MANDATORY_NOT_FOUND' }] },
      { action: 'ZohoCRM_createModules' }
    );
    expect(chrome.isToolError).toBe(true);
    expect(chrome.badgeLabel).toBe('✕');
    expect(chrome.title.toLowerCase()).toContain('failed');
    expect(chrome.title.toLowerCase()).not.toContain('created successfully');
  });

  test('live Tool-not-found fixture uses failure chrome despite isError false', () => {
    const chrome = deriveToolResultChrome(TOOL_NOT_FOUND_LIVE_FIXTURE, {
      action: 'ZohoCRM_createModule',
    });
    expect(chrome.isToolError).toBe(true);
    expect(chrome.badgeLabel).toBe('✕');
    expect(chrome.title.toLowerCase()).toContain('failed');
    expect(chrome.title.toLowerCase()).not.toContain('created successfully');
  });

  test('success create action keeps success chrome', () => {
    const chrome = deriveToolResultChrome(
      { isError: false, content: [] },
      { action: 'ZohoCRM_createModules' }
    );
    expect(chrome.isToolError).toBe(false);
    expect(chrome.badgeLabel).toBe('✓');
    expect(chrome.title.toLowerCase()).toContain('created successfully');
  });

  test('non-object parsed falls back to neutral success chrome without throwing', () => {
    expect(() => deriveToolResultChrome(null, { action: 'x' })).not.toThrow();
    expect(deriveToolResultChrome(null, null).isToolError).toBe(false);
    expect(deriveToolResultChrome('not-json', null).isToolError).toBe(false);
  });

  test('isError boolean formats as error tone, not green Yes', () => {
    const yes = formatToolResultBoolean('isError', true);
    expect(yes.tone).toBe('error');
    expect(yes.label.toLowerCase()).toContain('error');
    const no = formatToolResultBoolean('isError', false);
    expect(no.tone).toBe('neutral');
  });
});
