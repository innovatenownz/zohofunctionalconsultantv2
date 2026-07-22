/**
 * Pure helpers for Drive folder change-detection (no Google/auth imports).
 * Used by /api/chat to decide whether to reuse projects/{id}.driveCache.
 */

export type DriveFileMeta = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
};

/**
 * Returns true when the folder's file set is unchanged vs a prior cache:
 * same file IDs, same modifiedTimes, nothing added or removed.
 */
export function isDriveFolderUnchanged(
  cachedFiles: Array<{ id: string; modifiedTime?: string | null }>,
  currentFiles: Array<{ id?: string | null; modifiedTime?: string | null }>
): boolean {
  if (cachedFiles.length !== currentFiles.length) return false;

  const cachedMap = new Map(
    cachedFiles.map((f) => [f.id, f.modifiedTime || ''])
  );

  for (const file of currentFiles) {
    if (!file.id) return false;
    if (!cachedMap.has(file.id)) return false;
    if ((cachedMap.get(file.id) || '') !== (file.modifiedTime || '')) return false;
  }

  return true;
}
