import { getAdminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'Active' | 'Configuration Needed' | 'Inactive';
  mcpConfig?: any; // Stores parsed JSON config for MCP
  mcpServers?: any; // Legacy format
  selectedTools?: string[];
  driveFolderId?: string;
  lastSync?: string;
  /** Cached assembled Drive context for chat, invalidated via file id + modifiedTime. */
  driveCache?: {
    folderId: string;
    files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>;
    driveContext: string;
    cachedAt: string;
  };
  createdAt?: string;
  updatedAt?: string;
  enabledMcpServers?: string[];
  archived?: boolean;
  tags?: string[];
  
  // Context Area
  overallRequirements?: string;
  crmRoadmap?: string;
  projectContext?: string;
  plannedTools?: string;

  memorySpec?: {
    activeModules?: Array<{
      name: string;
      fields: Array<{ name: string; type: string; required: boolean }>;
      automations?: Array<{ name: string; trigger: string; action: string }>;
    }>;
    lastUpdated?: number;
  };
}


export interface ActivityLog {
  id?: string;
  projectId: string;
  type: 'user_message' | 'agent_message' | 'mcp_execution' | 'mcp_failure' | 'settings_update' | 'milestone_achieved';
  description: string;
  metadata?: any;
  timestamp: number;
}

// In-memory fallback for local development without Firebase config
const defaultOverallRequirements = `# Overall CRM Context & Requirements
- **Goal**: Implement a streamlined sales and pipeline management solution in Zoho CRM.
- **Key Goal**: Consolidate Lead intake, custom account tracking, and deal progression notifications.
- **Files Synced**: ` + "`" + `data_dictionary.md` + "`" + `, ` + "`" + `meeting_notes.txt` + "`" + `.`;

const defaultCrmRoadmap = `# Evolving CRM Roadmap
 
### 📦 Identified Modules & Layouts
- **Leads**: Standard B2B sales layout.
- **Deals**: Pipeline stages: Discovery, Evaluation, Proposal, Closed Won, Closed Lost.
 
### 🏷️ Custom Fields Needed
- **Leads**: ` + "`" + `Lead_Source_Detail` + "`" + ` (Single Line), ` + "`" + `Budget_Approved` + "`" + ` (Checkbox).
- **Deals**: ` + "`" + `Sales_Channel` + "`" + ` (Picklist: Direct, Partner, Referral).
 
### ⚡ Workflows & Automations
- Trigger an email notification to the Lead owner upon status change to "Qualified".
- Webhook notification to internal slack channel on new Deal creation.
 
### 📊 Reports & Dashboards
- "Monthly Sales Pipeline" report grouped by Deal Stage.`;

const defaultProjectContext = `Initial project setup. Determining CRM parameters and planning automations.`;
const defaultPlannedTools = `- ` + "`" + `list_tools` + "`" + ` to confirm Zoho schema access.
- ` + "`" + `insert_field` + "`" + ` or CRM equivalent actions to deploy fields.`;

const fallbackProjects: Project[] = [
  { 
    id: '1', 
    name: "Acme Corp", 
    status: "Active", 
    lastSync: "2 hours ago", 
    description: "Zoho CRM Implementation & Automation",
    overallRequirements: defaultOverallRequirements,
    crmRoadmap: defaultCrmRoadmap,
    projectContext: defaultProjectContext,
    plannedTools: defaultPlannedTools,
    archived: false,
    tags: ["Zoho CRM", "Google Drive", "OAuth"]
  },
  { 
    id: '2', 
    name: "Globex Inc", 
    status: "Active", 
    lastSync: "1 day ago", 
    description: "Zoho CRM Implementation & Automation",
    overallRequirements: defaultOverallRequirements,
    crmRoadmap: defaultCrmRoadmap,
    projectContext: defaultProjectContext,
    plannedTools: defaultPlannedTools,
    archived: false,
    tags: ["Zoho CRM", "Google Drive"]
  },
  { 
    id: '3', 
    name: "Stark Industries", 
    status: "Configuration Needed", 
    lastSync: "Never", 
    description: "Zoho CRM Implementation & Automation",
    overallRequirements: defaultOverallRequirements,
    crmRoadmap: defaultCrmRoadmap,
    projectContext: defaultProjectContext,
    plannedTools: defaultPlannedTools,
    archived: true,
    tags: ["Zoho CRM", "OAuth"]
  },
];

const fallbackActivities: Record<string, ActivityLog[]> = {};


export async function listProjects(): Promise<Project[]> {
  const db = getAdminDb();
  if (!db) {
    console.warn("Using fallback projects list");
    return fallbackProjects;
  }

  try {
    const snapshot = await db.collection('projects').orderBy('createdAt', 'desc').get();
    if (snapshot.empty) {
      // If collection is empty, seed it with fallback projects for first-time usage
      const projectsToSeed = [...fallbackProjects];
      for (const p of projectsToSeed) {
        const docRef = db.collection('projects').doc(p.id);
        const data = {
          ...p,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await docRef.set(data);
      }
      return projectsToSeed;
    }
    return snapshot.docs.map(doc => doc.data() as Project);
  } catch (error) {
    console.error("Error listing projects from firestore:", error);
    return fallbackProjects;
  }
}

export async function getProject(projectId: string): Promise<Project | null> {
  const db = getAdminDb();
  if (!db) {
    return fallbackProjects.find(p => p.id === projectId) || null;
  }

  try {
    const docRef = db.collection('projects').doc(projectId);
    const doc = await docRef.get();
    if (doc.exists) {
      return doc.data() as Project;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching project ${projectId}:`, error);
    return null;
  }
}

export async function createProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project> {
  const db = getAdminDb();
  const newProject: Project = {
    ...project,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!db) {
    fallbackProjects.unshift(newProject);
    return newProject;
  }

  try {
    const docRef = db.collection('projects').doc(newProject.id);
    await docRef.set(newProject);
    return newProject;
  } catch (error) {
    console.error("Error creating project in Firestore:", error);
    fallbackProjects.unshift(newProject);
    return newProject;
  }
}

export async function updateProject(projectId: string, updates: Partial<Project>): Promise<Project | null> {
  const db = getAdminDb();
  const updatedAt = new Date().toISOString();

  if (!db) {
    const index = fallbackProjects.findIndex(p => p.id === projectId);
    if (index !== -1) {
      fallbackProjects[index] = { ...fallbackProjects[index], ...updates, updatedAt };
      return fallbackProjects[index];
    }
    return null;
  }

  try {
    const docRef = db.collection('projects').doc(projectId);
    const data = { ...updates, updatedAt };
    await docRef.update(data);
    
    const doc = await docRef.get();
    return doc.data() as Project;
  } catch (error) {
    console.error(`Error updating project ${projectId}:`, error);
    return null;
  }
}

// Firestore rejects documents deeper than 20 levels or containing cycles.
// Activity metadata may include arbitrary MCP tool results, so defensively cap
// depth, break cycles, and truncate oversized strings/arrays before writing.
const MAX_METADATA_DEPTH = 8;
const MAX_STRING_LENGTH = 5000;
const MAX_ARRAY_LENGTH = 100;
/** Chat transcripts need room for compact list_tools (~29KB) and get_tool_schema payloads. */
export const CHAT_MESSAGE_MAX_STRING_LENGTH = 50_000;

export type SanitizeForFirestoreOptions = {
  maxStringLength?: number;
};

export function sanitizeForFirestore(
  value: any,
  depth = 0,
  seen = new WeakSet(),
  options?: SanitizeForFirestoreOptions
): any {
  const maxStringLength = options?.maxStringLength ?? MAX_STRING_LENGTH;
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === 'string') {
    return value.length > maxStringLength
      ? value.slice(0, maxStringLength) + `…[truncated ${value.length - maxStringLength} chars]`
      : value;
  }
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return value.toString();
  if (t === 'function' || t === 'symbol') return undefined;

  // Objects/arrays beyond the depth cap are collapsed to a truncated JSON string.
  if (depth >= MAX_METADATA_DEPTH) {
    try {
      const s = JSON.stringify(value);
      return s && s.length > maxStringLength ? s.slice(0, maxStringLength) + '…[truncated]' : s ?? '[unserializable]';
    } catch {
      return '[too deep or unserializable]';
    }
  }

  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const arr = value.slice(0, MAX_ARRAY_LENGTH).map((v) => sanitizeForFirestore(v, depth + 1, seen, options));
      if (value.length > MAX_ARRAY_LENGTH) arr.push(`…[${value.length - MAX_ARRAY_LENGTH} more items truncated]`);
      return arr;
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      const sv = sanitizeForFirestore(v, depth + 1, seen, options);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export async function logActivity(
  projectId: string,
  type: ActivityLog['type'],
  description: string,
  metadata?: any
): Promise<ActivityLog> {
  const db = getAdminDb();
  const log: ActivityLog = {
    projectId,
    type,
    description,
    metadata: metadata != null ? sanitizeForFirestore(metadata) : null,
    timestamp: Date.now(),
  };

  if (!db) {
    if (!fallbackActivities[projectId]) {
      fallbackActivities[projectId] = [];
    }
    fallbackActivities[projectId].unshift(log);
    return log;
  }

  try {
    const activityRef = db.collection('projects').doc(projectId).collection('activities').doc();
    const logWithId = { ...log, id: activityRef.id };
    await activityRef.set(logWithId);
    return logWithId;
  } catch (error) {
    console.error(`Error saving activity log for project ${projectId}:`, error);
    if (!fallbackActivities[projectId]) {
      fallbackActivities[projectId] = [];
    }
    fallbackActivities[projectId].unshift(log);
    return log;
  }
}

export async function getActivityLogs(projectId: string): Promise<ActivityLog[]> {
  const db = getAdminDb();
  if (!db) {
    return fallbackActivities[projectId] || [];
  }

  try {
    const snapshot = await db
      .collection('projects')
      .doc(projectId)
      .collection('activities')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    
    if (snapshot.empty) {
      return fallbackActivities[projectId] || [];
    }
    
    return snapshot.docs.map(doc => doc.data() as ActivityLog);
  } catch (error) {
    console.error(`Error fetching activity logs for project ${projectId}:`, error);
    return fallbackActivities[projectId] || [];
  }
}

/**
 * Uses a heuristic or LLM-style parsing to update project memory spec
 * based on messages or MCP execution details.
 */
export async function updateProjectMemoryFromExecution(
  projectId: string,
  action: string,
  args: any,
  success: boolean
): Promise<void> {
  if (!success) return;

  const project = await getProject(projectId);
  if (!project) return;

  const memory = project.memorySpec || { activeModules: [], lastUpdated: Date.now() };
  const modules = memory.activeModules || [];

  // Parse if Zoho MCP action is related to setting up schema/automations
  // Action names in Zoho MCP typically: create_module, update_module, add_fields, create_workflow, create_blueprint
  const cleanAction = action.toLowerCase();
  
  if (cleanAction.includes('module') || cleanAction.includes('field') || cleanAction.includes('workflow') || cleanAction.includes('blueprint')) {
    if (cleanAction === 'create_module' || cleanAction === 'setup_module') {
      const moduleName = args.module || args.name || 'Custom Module';
      if (!modules.some(m => m.name.toLowerCase() === moduleName.toLowerCase())) {
        modules.push({
          name: moduleName,
          fields: args.fields || [],
          automations: args.automations || []
        });
      }
    } else if (cleanAction === 'add_fields' || cleanAction === 'create_field') {
      const moduleName = args.module || args.name || 'Custom Module';
      const newFields = args.fields || (args.field ? [args.field] : []);
      
      const mod = modules.find(m => m.name.toLowerCase() === moduleName.toLowerCase());
      if (mod) {
        newFields.forEach((f: any) => {
          if (!mod.fields.some(field => field.name.toLowerCase() === f.name.toLowerCase())) {
            mod.fields.push({
              name: f.name,
              type: f.type || 'text',
              required: !!f.required
            });
          }
        });
      } else {
        modules.push({
          name: moduleName,
          fields: newFields.map((f: any) => ({
            name: f.name,
            type: f.type || 'text',
            required: !!f.required
          })),
          automations: []
        });
      }
    } else if (cleanAction === 'create_workflow' || cleanAction === 'create_blueprint' || cleanAction === 'setup_automation') {
      const moduleName = args.module || args.name || 'Custom Module';
      const automationName = args.workflow_name || args.blueprint_name || args.automation_name || 'Automation Rule';
      const trigger = args.trigger || 'On Record Save';
      const act = args.action || 'Execute Action';

      const mod = modules.find(m => m.name.toLowerCase() === moduleName.toLowerCase());
      if (mod) {
        if (!mod.automations) mod.automations = [];
        if (!mod.automations.some(a => a.name.toLowerCase() === automationName.toLowerCase())) {
          mod.automations.push({ name: automationName, trigger, action: act });
        }
      } else {
        modules.push({
          name: moduleName,
          fields: [],
          automations: [{ name: automationName, trigger, action: act }]
        });
      }
    }

    memory.activeModules = modules;
    memory.lastUpdated = Date.now();
    
    await updateProject(projectId, { memorySpec: memory, status: 'Active' });
  }
}

export interface ChatSession {
  id: string;
  projectId: string;
  title: string;
  messages: Array<any>;
  createdAt: number;
  updatedAt: number;
  summary?: string;
}

const fallbackChats: Record<string, ChatSession[]> = {};

export async function migrateExistingChat(projectId: string): Promise<void> {
  const db = getAdminDb();
  if (!db) return;

  try {
    const legacyChatRef = db.collection('chats').doc(projectId);
    const snapshot = await legacyChatRef.get();
    
    if (snapshot.exists) {
      const data = snapshot.data();
      const messages = data?.messages || [];
      
      if (messages.length > 0) {
        const chatsCollection = db.collection('projects').doc(projectId).collection('chats');
        const newChatRef = chatsCollection.doc();
        const dateStr = new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
        
        await newChatRef.set({
          id: newChatRef.id,
          projectId,
          title: `Chat Session - ${dateStr}`,
          messages,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
      
      // Delete old document so we don't migrate it again
      await legacyChatRef.delete();
    }
  } catch (error) {
    console.error(`Error migrating legacy chat for project ${projectId}:`, error);
  }
}

export async function listChats(projectId: string): Promise<ChatSession[]> {
  // First run migration to ensure any existing legacy chat is imported
  await migrateExistingChat(projectId);

  const db = getAdminDb();
  if (!db) {
    return fallbackChats[projectId] || [];
  }

  try {
    const snapshot = await db
      .collection('projects')
      .doc(projectId)
      .collection('chats')
      .orderBy('createdAt', 'desc')
      .get();
      
    return snapshot.docs.map(doc => doc.data() as ChatSession);
  } catch (error) {
    console.error(`Error listing chats for project ${projectId}:`, error);
    return fallbackChats[projectId] || [];
  }
}

export async function createChat(projectId: string, title?: string): Promise<ChatSession> {
  const db = getAdminDb();
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  
  const newChat: ChatSession = {
    id: Math.random().toString(36).substring(2, 11),
    projectId,
    title: title || `Chat Session - ${dateStr}`,
    messages: [
      {
        role: 'agent',
        content: 'Hello! I am your Zoho Suite & Integration Consultant Agent. I have access to the Google Drive documentation. What would you like to build today?',
        timestamp: Date.now()
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  if (!db) {
    if (!fallbackChats[projectId]) fallbackChats[projectId] = [];
    fallbackChats[projectId].unshift(newChat);
    return newChat;
  }

  try {
    const docRef = db.collection('projects').doc(projectId).collection('chats').doc(newChat.id);
    await docRef.set(newChat);
    return newChat;
  } catch (error) {
    console.error(`Error creating chat for project ${projectId}:`, error);
    if (!fallbackChats[projectId]) fallbackChats[projectId] = [];
    fallbackChats[projectId].unshift(newChat);
    return newChat;
  }
}

export async function updateChat(projectId: string, chatId: string, updates: Partial<ChatSession>): Promise<ChatSession | null> {
  const db = getAdminDb();
  const updatedAt = Date.now();

  if (!db) {
    const chats = fallbackChats[projectId] || [];
    const index = chats.findIndex(c => c.id === chatId);
    if (index !== -1) {
      fallbackChats[projectId][index] = { ...chats[index], ...updates, updatedAt };
      return fallbackChats[projectId][index];
    }
    return null;
  }

  try {
    const docRef = db.collection('projects').doc(projectId).collection('chats').doc(chatId);
    await docRef.update({ ...updates, updatedAt });
    const doc = await docRef.get();
    return doc.data() as ChatSession;
  } catch (error) {
    console.error(`Error updating chat ${chatId} for project ${projectId}:`, error);
    return null;
  }
}

export async function deleteChat(projectId: string, chatId: string): Promise<boolean> {
  const db = getAdminDb();
  if (!db) {
    const chats = fallbackChats[projectId] || [];
    const index = chats.findIndex(c => c.id === chatId);
    if (index !== -1) {
      fallbackChats[projectId].splice(index, 1);
      return true;
    }
    return false;
  }

  try {
    const docRef = db.collection('projects').doc(projectId).collection('chats').doc(chatId);
    await docRef.delete();
    return true;
  } catch (error) {
    console.error(`Error deleting chat ${chatId} for project ${projectId}:`, error);
    return false;
  }
}

export async function getChat(projectId: string, chatId: string): Promise<ChatSession | null> {
  const db = getAdminDb();
  if (!db) {
    const chats = fallbackChats[projectId] || [];
    return chats.find(c => c.id === chatId) || null;
  }
  try {
    const docRef = db.collection('projects').doc(projectId).collection('chats').doc(chatId);
    const snapshot = await docRef.get();
    return snapshot.exists ? (snapshot.data() as ChatSession) : null;
  } catch (error) {
    console.error(`Error getting chat ${chatId} for project ${projectId}:`, error);
    return null;
  }
}

// Append one or more messages to a chat's transcript using the Admin SDK.
// Runs server-side only, so it bypasses Firestore security rules entirely.
export async function appendChatMessages(projectId: string, chatId: string, newMessages: any[]): Promise<void> {
  if (!newMessages || newMessages.length === 0) return;
  const sanitized = newMessages.map((m) =>
    sanitizeForFirestore(m, 0, new WeakSet(), { maxStringLength: CHAT_MESSAGE_MAX_STRING_LENGTH })
  );
  const db = getAdminDb();
  const updatedAt = Date.now();

  if (!db) {
    const chats = fallbackChats[projectId] || [];
    const index = chats.findIndex(c => c.id === chatId);
    if (index !== -1) {
      const existing = chats[index];
      fallbackChats[projectId][index] = {
        ...existing,
        messages: [...(existing.messages || []), ...sanitized],
        updatedAt,
      };
    }
    return;
  }

  try {
    const docRef = db.collection('projects').doc(projectId).collection('chats').doc(chatId);
    await docRef.update({ messages: FieldValue.arrayUnion(...sanitized), updatedAt });
  } catch (error) {
    console.error(`Error appending messages to chat ${chatId} for project ${projectId}:`, error);
  }
}

