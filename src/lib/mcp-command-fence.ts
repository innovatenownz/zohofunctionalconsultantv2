/**
 * Deterministic truncation of model output at the first mcp-command fence.
 * Discard anything the model wrote after the closing ``` so fabricated
 * success/failure narration never reaches the client stream or Firestore.
 */

const MCP_COMMAND_OPEN = /```mcp-command\r?\n/;

export type TruncateAtMcpCommandResult = {
  /** Text ending at the closing fence of the first mcp-command block (inclusive). */
  text: string;
  /** True when trailing model text after the fence was removed. */
  truncated: boolean;
  /** Byte offset where the truncated text ends in the original string; -1 if no complete fence. */
  fenceEndIndex: number;
};

/**
 * If `text` contains a complete ```mcp-command ... ``` block, return only the
 * prefix through that block's closing fence. Otherwise return `text` unchanged.
 */
export function truncateModelTextAtMcpCommand(text: string): TruncateAtMcpCommandResult {
  if (!text) {
    return { text: text ?? '', truncated: false, fenceEndIndex: -1 };
  }

  const openMatch = MCP_COMMAND_OPEN.exec(text);
  if (!openMatch || openMatch.index === undefined) {
    return { text, truncated: false, fenceEndIndex: -1 };
  }

  const bodyStart = openMatch.index + openMatch[0].length;
  const closeRel = text.slice(bodyStart).indexOf('```');
  if (closeRel < 0) {
    // Opening fence seen but not yet closed — keep streaming as-is.
    return { text, truncated: false, fenceEndIndex: -1 };
  }

  const fenceEndIndex = bodyStart + closeRel + 3; // include closing ```
  const truncatedText = text.slice(0, fenceEndIndex);
  return {
    text: truncatedText,
    truncated: fenceEndIndex < text.length,
    fenceEndIndex,
  };
}

/**
 * Given previously streamed length and the latest accumulated raw model text,
 * return the next delta (if any) that is still at-or-before the mcp-command fence.
 * Returns empty string when the fence is already fully streamed and further
 * model tokens should be suppressed.
 */
export function nextStreamDeltaUpToMcpFence(
  previousStreamedLength: number,
  accumulatedRawText: string
): { delta: string; streamedLength: number; fenceClosed: boolean } {
  const { text: allowed, fenceEndIndex } = truncateModelTextAtMcpCommand(accumulatedRawText);
  const fenceClosed = fenceEndIndex >= 0;
  const targetLength = fenceClosed ? allowed.length : accumulatedRawText.length;
  if (previousStreamedLength >= targetLength) {
    return { delta: '', streamedLength: previousStreamedLength, fenceClosed };
  }
  const delta = (fenceClosed ? allowed : accumulatedRawText).slice(previousStreamedLength, targetLength);
  return { delta, streamedLength: targetLength, fenceClosed };
}
