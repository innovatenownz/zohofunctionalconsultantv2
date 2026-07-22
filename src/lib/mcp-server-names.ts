/** Union of configured, enabled, and credential-backed server names (deduped, stable order). */
export function getUnionMcpServerNames(
  mcpConfig: unknown,
  enabledMcpServers?: string[] | null,
  credentialServerNames?: string[] | null
): string[] {
  const names = new Set<string>();

  if (mcpConfig && typeof mcpConfig === 'object') {
    const record = mcpConfig as Record<string, unknown>;
    if (
      record.mcpServers &&
      typeof record.mcpServers === 'object' &&
      !Array.isArray(record.mcpServers)
    ) {
      for (const key of Object.keys(record.mcpServers as object)) {
        names.add(key);
      }
    }
  }

  for (const name of enabledMcpServers || []) {
    if (typeof name === 'string' && name.trim()) names.add(name.trim());
  }

  for (const name of credentialServerNames || []) {
    if (typeof name === 'string' && name.trim()) names.add(name.trim());
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}
