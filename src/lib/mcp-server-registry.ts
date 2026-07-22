import { getAdminDb } from '@/lib/firebase-admin';
import { getProject, updateProject } from '@/lib/project-service';

export type McpServerDeleteResult = {
  serverName: string;
  removedFromCredentials: boolean;
  removedFromMcpConfig: boolean;
  removedFromEnabledList: boolean;
  errors: string[];
};

/** List mcpCredentials subcollection document IDs for a project. */
export async function listMcpCredentialServerNames(projectId: string): Promise<string[]> {
  const db = getAdminDb();
  if (!db) return [];

  const snap = await db
    .collection('projects')
    .doc(projectId)
    .collection('mcpCredentials')
    .get();

  return snap.docs.map((doc) => doc.id).sort();
}

/**
 * Remove an MCP server from mcpCredentials, mcpConfig, and enabledMcpServers.
 * Continues on partial failure and reports what was cleaned.
 */
export async function deleteMcpServerFromProject(
  projectId: string,
  serverName: string
): Promise<McpServerDeleteResult> {
  const result: McpServerDeleteResult = {
    serverName,
    removedFromCredentials: false,
    removedFromMcpConfig: false,
    removedFromEnabledList: false,
    errors: [],
  };

  const project = await getProject(projectId);
  if (!project) {
    result.errors.push('Project not found');
    return result;
  }

  const db = getAdminDb();

  if (db) {
    try {
      const credRef = db
        .collection('projects')
        .doc(projectId)
        .collection('mcpCredentials')
        .doc(serverName);
      const credDoc = await credRef.get();
      if (credDoc.exists) {
        await credRef.delete();
        result.removedFromCredentials = true;
      }
    } catch (err) {
      result.errors.push(
        `Failed to delete credentials: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    // In-memory / local dev without Firestore — skip credential subcollection cleanup.
  }

  const mcpConfig = project.mcpConfig || { mcpServers: {} };
  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

  const hadConfigEntry = Boolean(mcpConfig.mcpServers[serverName]);
  if (hadConfigEntry) {
    delete mcpConfig.mcpServers[serverName];
    result.removedFromMcpConfig = true;
  }

  const enabledBefore = project.enabledMcpServers || [];
  const enabledAfter = enabledBefore.filter((s) => s !== serverName);
  if (enabledAfter.length !== enabledBefore.length) {
    result.removedFromEnabledList = true;
  }

  try {
    await updateProject(projectId, {
      mcpConfig,
      enabledMcpServers: enabledAfter,
    });
  } catch (err) {
    result.errors.push(
      `Failed to update project config: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

export function isMcpServerFullyRemoved(result: McpServerDeleteResult): boolean {
  const removedSomething =
    result.removedFromCredentials ||
    result.removedFromMcpConfig ||
    result.removedFromEnabledList;

  return result.errors.length === 0 && removedSomething;
}
