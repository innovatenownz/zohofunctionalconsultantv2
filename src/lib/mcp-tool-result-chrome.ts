/**
 * Pure presentation helpers for MCP tool result widgets (no React imports).
 * Used by A2UIWidget and unit-tested independently.
 */

export type ToolResultChrome = {
  isToolError: boolean;
  title: string;
  badgeLabel: string;
  badgeColor: string;
  badgeBackground: string;
};

function formatActionTitle(action: string, isToolError: boolean): string {
  const parts = action.split(/[_-]/);
  const serverName = parts[0]?.toUpperCase() || 'Integration';
  const actionName = parts.slice(1).join(' ');

  if (isToolError) {
    return `${serverName}: ${actionName ? actionName.charAt(0).toUpperCase() + actionName.slice(1) : 'Command'} Failed`;
  }

  if (action.includes('list_tools')) {
    return 'MCP Connections: Available Tools';
  }
  if (action.includes('get_modules') || action.includes('list_modules')) {
    return `${serverName}: Available Modules`;
  }
  if (action.includes('get_fields') || action.includes('list_fields')) {
    return `${serverName}: Field Configuration Schema`;
  }
  if (action.includes('insert') || action.includes('create') || action.includes('add')) {
    return `${serverName}: Record Created Successfully`;
  }
  if (action.includes('search') || action.includes('query') || action.includes('get')) {
    return `${serverName}: Data Query Results`;
  }

  return `${serverName}: ${actionName.charAt(0).toUpperCase() + actionName.slice(1)}`;
}

/**
 * Derives header chrome for a parsed MCP/tool JSON payload.
 * Malformed / non-object parsed values → neutral success-styled fallback (never throws).
 */
export function deriveToolResultChrome(
  parsed: unknown,
  commandContext?: { action?: string } | null
): ToolResultChrome {
  const isToolError =
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).isError === true;

  let title = 'Integration Result';
  try {
    if (commandContext?.action && typeof commandContext.action === 'string') {
      title = formatActionTitle(commandContext.action, isToolError);
    } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (obj.tools) title = isToolError ? 'MCP Service: Tool Call Failed' : 'MCP Service: Available Tools';
      else if (obj.modules) title = isToolError ? 'Zoho: Modules Request Failed' : 'Zoho: Modules List';
      else if (obj.fields) title = isToolError ? 'Zoho: Fields Request Failed' : 'Zoho: Fields Schema';
      else if (isToolError) title = 'Integration Result Failed';
    } else if (isToolError) {
      title = 'Integration Result Failed';
    }
  } catch {
    title = isToolError ? 'Integration Result Failed' : 'Integration Result';
  }

  if (isToolError) {
    return {
      isToolError: true,
      title,
      badgeLabel: '✕',
      badgeColor: 'var(--error-color, #f87171)',
      badgeBackground: 'rgba(248, 113, 113, 0.15)',
    };
  }

  return {
    isToolError: false,
    title,
    badgeLabel: '✓',
    badgeColor: 'var(--success-color)',
    badgeBackground: 'rgba(16, 185, 129, 0.15)',
  };
}

/** Format boolean display for object fields; special-case isError for clarity. */
export function formatToolResultBoolean(key: string, val: boolean): { label: string; tone: 'error' | 'success' | 'neutral' } {
  if (key === 'isError' || key.toLowerCase() === 'iserror') {
    return val
      ? { label: 'Yes — tool error', tone: 'error' }
      : { label: 'No', tone: 'neutral' };
  }
  return val
    ? { label: '✓ Yes', tone: 'success' }
    : { label: '✗ No', tone: 'neutral' };
}
