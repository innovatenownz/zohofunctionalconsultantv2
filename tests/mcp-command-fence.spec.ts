import { test, expect } from '@playwright/test';
import {
  nextStreamDeltaUpToMcpFence,
  truncateModelTextAtMcpCommand,
} from '../src/lib/mcp-command-fence';

/**
 * Simulates the exact failure mode from chat fzbc1kup3 turn 3:
 * model emits mcp-command, then fabricates a success block with docs-style IDs
 * before the backend appends the real tool result.
 */
const FABRICATED_AFTER_FENCE = `Based on the schema for ZohoCRM_createModules, a profile ID is required. I will now fetch the available profiles to proceed.\`\`\`mcp-command
{
  "action": "ZohoCRM_getProfiles",
  "serverName": "innovatenowcrm"
}
\`\`\`

**✅ MCP Command Executed Successfully:**
\`\`\`json
{
  "profiles": [
    {
      "display_label": "Administrator",
      "id": "4061000000034005"
    }
  ]
}
\`\`\`
`;

const REAL_BACKEND_RESULT = `

**✅ MCP Command Executed Successfully:**
\`\`\`json
{
  "content": [{ "type": "text", "text": "{\\"profiles\\":[{\\"id\\":\\"111461000000040385\\"}]}" }],
  "structuredContent": {
    "status": "success",
    "data": { "profiles": [{ "id": "111461000000040385", "name": "Administrator" }] }
  },
  "isError": false
}
\`\`\``;

test.describe('truncateModelTextAtMcpCommand', () => {
  test('strips fabricated success narration after the mcp-command closing fence', () => {
    const { text, truncated, fenceEndIndex } = truncateModelTextAtMcpCommand(FABRICATED_AFTER_FENCE);

    expect(truncated).toBe(true);
    expect(fenceEndIndex).toBeGreaterThan(0);
    expect(text).toContain('```mcp-command');
    expect(text).toContain('"action": "ZohoCRM_getProfiles"');
    expect(text.endsWith('```')).toBe(true);
    expect(text).not.toContain('4061000000034005');
    expect(text).not.toContain('**✅ MCP Command Executed Successfully:**');
    expect(text).not.toContain('"profiles"');
  });

  test('persisted assistant content keeps only real backend result after the command', () => {
    const { text: modelOnly } = truncateModelTextAtMcpCommand(FABRICATED_AFTER_FENCE);
    const assistantContent = modelOnly + REAL_BACKEND_RESULT;

    expect(assistantContent).toContain('```mcp-command');
    expect(assistantContent).toContain('111461000000040385');
    expect(assistantContent).not.toContain('4061000000034005');

    // Exactly one success header — the backend-appended one
    const successHeaders = assistantContent.match(/\*\*✅ MCP Command Executed Successfully:\*\*/g) || [];
    expect(successHeaders).toHaveLength(1);
  });

  test('leaves text unchanged when there is no mcp-command block', () => {
    const raw = 'Just a normal reply with no tool call.';
    const { text, truncated, fenceEndIndex } = truncateModelTextAtMcpCommand(raw);
    expect(text).toBe(raw);
    expect(truncated).toBe(false);
    expect(fenceEndIndex).toBe(-1);
  });

  test('leaves text unchanged while the mcp-command fence is still open', () => {
    const raw = 'Working...\n```mcp-command\n{\n  "action": "list_tools"\n}\n';
    const { text, truncated, fenceEndIndex } = truncateModelTextAtMcpCommand(raw);
    expect(text).toBe(raw);
    expect(truncated).toBe(false);
    expect(fenceEndIndex).toBe(-1);
  });

  test('streaming helper suppresses deltas after the fence closes', () => {
    // Stream in three chunks: preface+open, body+close, then fabricated narration
    let raw = '';
    let streamed = 0;
    const out: string[] = [];

    const chunks = [
      'Let me check the profiles.```mcp-command\n',
      '{\n  "action": "ZohoCRM_getProfiles"\n}\n```',
      '\n\n**✅ MCP Command Executed Successfully:**\n```json\n{"profiles":[{"id":"4061000000034005"}]}\n```\n',
    ];

    for (const chunk of chunks) {
      raw += chunk;
      const step = nextStreamDeltaUpToMcpFence(streamed, raw);
      if (step.delta) out.push(step.delta);
      streamed = step.streamedLength;
    }

    const streamedText = out.join('');
    expect(streamedText).toContain('```mcp-command');
    expect(streamedText.endsWith('```')).toBe(true);
    expect(streamedText).not.toContain('4061000000034005');
    expect(streamedText).not.toContain('**✅ MCP Command Executed Successfully:**');
  });
});
