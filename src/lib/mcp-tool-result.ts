/**
 * Interprets an MCP CallToolResult-shaped payload.
 * Tool execution errors may use isError: true (MCP standard) or Zoho-specific
 * structuredContent.status envelopes where isError is false.
 */

export type McpToolResultInterpretation = {
  ok: boolean;
  errorSummary?: string;
};

const MAX_ERROR_SUMMARY_CHARS = 200;

const FAILURE_STATUSES = new Set(['failure', 'error', 'failed']);

const KNOWN_ZOHO_ERROR_CODE = /^(OAUTH_SCOPE_MISMATCH|MANDATORY_NOT_FOUND|INVALID_DATA|INVALID_MODULE|AUTHENTICATION_FAILURE|INSUFFICIENT_PRIVILEGE)/i;

function truncateSummary(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= MAX_ERROR_SUMMARY_CHARS) return trimmed;
  return trimmed.slice(0, MAX_ERROR_SUMMARY_CHARS - 1) + '…';
}

function normalizeStatus(status: unknown): string | null {
  if (typeof status !== 'string') return null;
  const trimmed = status.trim().toLowerCase();
  return trimmed || null;
}

function isFailureStatus(status: string | null): boolean {
  return status !== null && FAILURE_STATUSES.has(status);
}

function isKnownZohoErrorCode(code: string): boolean {
  return KNOWN_ZOHO_ERROR_CODE.test(code.trim());
}

function nestedDataMessage(structured: Record<string, unknown>): string | null {
  const data = structured.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const msg = (data as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return null;
}

function summaryFromStructuredContent(structured: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const code = structured.code ?? structured.error_code ?? structured.errorCode;
  const message =
    structured.message ??
    nestedDataMessage(structured) ??
    structured.error_description ??
    structured.errorDescription ??
    structured.error ??
    structured.details;

  if (typeof code === 'string' && code.trim()) parts.push(code.trim());
  if (typeof message === 'string' && message.trim()) {
    const msg = message.trim();
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

function extractSummary(record: Record<string, unknown>): string | null {
  if (
    record.structuredContent &&
    typeof record.structuredContent === 'object' &&
    !Array.isArray(record.structuredContent)
  ) {
    const fromStructured = summaryFromStructuredContent(
      record.structuredContent as Record<string, unknown>
    );
    if (fromStructured) return fromStructured;
  }

  return summaryFromContentBlocks(record.content);
}

function joinContentText(content: unknown): string | null {
  return summaryFromContentBlocks(content);
}

function matchesHighConfidenceFailureText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (/^Tool not found:/i.test(trimmed)) return true;
  if (/^[A-Z][A-Z0-9_]*_(NOT_FOUND|MISMATCH|DENIED|INVALID|ERROR)\b/.test(trimmed)) return true;
  if (/^invalid oauth scope/i.test(trimmed)) return true;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        if (isFailureStatus(normalizeStatus(parsed.status))) return true;
        const code = parsed.code;
        if (typeof code === 'string' && isKnownZohoErrorCode(code)) return true;
      }
    } catch {
      /* ignore malformed JSON in content */
    }
  }

  return false;
}

function isListToolsWrapper(record: Record<string, unknown>): boolean {
  return (
    'tools' in record &&
    !('content' in record) &&
    record.isError === undefined
  );
}

type FailureDetection = {
  summary: string;
  tier: 1 | 2 | 3;
};

function detectToolFailure(record: Record<string, unknown>): FailureDetection | null {
  // Tier 1 — MCP standard
  if (record.isError === true) {
    return {
      tier: 1,
      summary: extractSummary(record) ?? 'Tool reported an error (isError: true)',
    };
  }

  // Tier 2 — Zoho structuredContent envelope
  const structured = record.structuredContent;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    const obj = structured as Record<string, unknown>;
    const status = normalizeStatus(obj.status ?? (obj.data as Record<string, unknown> | undefined)?.status);
    if (isFailureStatus(status)) {
      return {
        tier: 2,
        summary: extractSummary(record) ?? `Tool failed (status: ${status})`,
      };
    }

    const code = obj.code ?? obj.error_code ?? obj.errorCode;
    if (typeof code === 'string' && isKnownZohoErrorCode(code)) {
      return {
        tier: 2,
        summary: extractSummary(record) ?? code,
      };
    }
  }

  // Tier 3 — narrow content-text patterns (low confidence)
  const text = joinContentText(record.content);
  if (text && matchesHighConfidenceFailureText(text)) {
    console.warn(
      '[McpToolResult] Tier-3 failure detected from content text:',
      text.slice(0, 120)
    );
    return { tier: 3, summary: text };
  }

  return null;
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

  if (isListToolsWrapper(record)) {
    return { ok: true };
  }

  const failure = detectToolFailure(record);
  if (!failure) {
    return { ok: true };
  }

  return {
    ok: false,
    errorSummary: truncateSummary(failure.summary),
  };
}
