import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listProjects, createProject, logActivity } from '@/lib/project-service';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (error: any) {
    console.error("API GET Projects Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();

    const { name, description, driveFolderId, mcpConfig, tags } = body;

    if (!name) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    let mcpConfigJson = mcpConfig;
    if (typeof mcpConfig === 'string') {
      try {
        mcpConfigJson = JSON.parse(mcpConfig);
      } catch {
        mcpConfigJson = { mcpServers: {} };
      }
    }
    if (!mcpConfigJson || (typeof mcpConfigJson === 'object' && Object.keys(mcpConfigJson).length === 0)) {
      mcpConfigJson = { mcpServers: {} };
    }

    const projectId = Math.random().toString(36).substring(2, 11);
    const project = await createProject({
      id: projectId,
      name,
      description: description || "Zoho CRM Implementation & Automation",
      status: (mcpConfigJson && mcpConfigJson.mcpServers && Object.keys(mcpConfigJson.mcpServers).length > 0) ? "Active" : "Configuration Needed",
      driveFolderId: driveFolderId || "",
      mcpConfig: mcpConfigJson,
      lastSync: driveFolderId ? "Synced just now" : "Never",
      archived: false,
      tags: tags || []
    });

    // Log the creation activity
    await logActivity(
      projectId,
      'settings_update',
      `Project created by ${session?.user?.name || 'System User'}`,
      { name, driveFolderId: driveFolderId || null, hasMcpConfig: !!mcpConfig, tags: tags || [] }
    );

    return NextResponse.json({ project });
  } catch (error: any) {
    console.error("API POST Projects Error:", error);
    return NextResponse.json({ error: error.message || "Failed to create project" }, { status: 500 });
  }
}
