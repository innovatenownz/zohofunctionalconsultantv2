/**
 * Interprets an MCP CallToolResult-shaped payload.
 * Tool execution errors are returned with isError: true (not thrown as protocol errors).
 */

export type McpToolResultInterpretation = {
  ok: boolean;
  errorSummary?: string;
};

const MAX_ERROR_SUMMARY_CHARS = 200;

function truncateSummary(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= MAX_ERROR_SUMMARY_CHARS) return trimmed;
  return trimmed.slice(0, MAX_ERROR_SUMMARY_CHARS - 1) + '…';
}

function summaryFromStructuredContent(structured: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const code = structured.code ?? structured.error_code ?? structured.errorCode;
  const message =
    structured.message ??
    structured.error_description ??
    structured.errorDescription ??
    structured.error ??
    structured.details;

  if (typeof code === 'string' && code.trim()) parts.push(code.trim());
  if (typeof message === 'string' && message.trim()) {
    const msg = message.trim();
    // Avoid duplicating if message already starts with the code
    if (!parts.length || !msg.startsWith(parts[0])) parts.push(msg);
  } else if (message != null && typeof message !== 'string') {
    try {
      parts.push(JSON.stringify(message));
    } catch {
      /* ignore */
    }
  }

  if (parts.length === 0) return null;
  return parts.join(': ');
}

function summaryFromContentBlocks(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      const t = (block as { text: string }).text.trim();
      if (t) texts.push(t);
    }
  }
  if (texts.length === 0) return null;
  return texts.join(' ');
}

/**
 * Returns whether an MCP tool result should be treated as success for UI/history,
 * plus a short error summary when it failed.
 *
 * Non-objects (null/undefined/primitives) are treated as success so callers
 * fall through to existing stringify + display behavior without crashing.
 */
export function interpretMcpToolResult(result: unknown): McpToolResultInterpretation {
  if (result === null || result === undefined || typeof result !== 'object') {
    return { ok: true };
  }

  const record = result as Record<string, unknown>;
  if (record.isError !== true) {
    return { ok: true };
  }

  let summary: string | null = null;

  if (
    record.structuredContent &&
    typeof record.structuredContent === 'object' &&
    !Array.isArray(record.structuredContent)
  ) {
    summary = summaryFromStructuredContent(record.structuredContent as Record<string, unknown>);
  }

  if (!summary) {
    summary = summaryFromContentBlocks(record.content);
  }

  if (!summary) {
    summary = 'Tool reported an error (isError: true)';
  }

  return {
    ok: false,
    errorSummary: truncateSummary(summary),
  };
}
