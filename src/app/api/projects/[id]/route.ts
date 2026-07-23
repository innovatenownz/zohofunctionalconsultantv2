import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getProject, updateProject, logActivity, deleteProject } from '@/lib/project-service';
import { listMcpCredentialServerNames } from '@/lib/mcp-server-registry';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // In Next.js 15, we should await params or handle it safely.
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    
    const project = await getProject(projectId);
    
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const mcpCredentialServerNames = await listMcpCredentialServerNames(projectId);
    
    return NextResponse.json({ project: { ...project, mcpCredentialServerNames } });
  } catch (error: any) {
    console.error("API GET Project Details Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch project details" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const body = await req.json();
    
    const { 
      name, 
      description, 
      driveFolderId, 
      mcpConfig, 
      mcpServers,
      selectedTools,
      enabledMcpServers,
      overallRequirements, 
      crmRoadmap, 
      projectContext, 
      plannedTools,
      status,
      archived,
      tags
    } = body;
    
    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (driveFolderId !== undefined) updates.driveFolderId = driveFolderId;
    if (mcpConfig !== undefined) {
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
      updates.mcpConfig = mcpConfigJson;
    }
    if (mcpServers !== undefined) updates.mcpServers = mcpServers;
    if (selectedTools !== undefined) updates.selectedTools = selectedTools;
    if (enabledMcpServers !== undefined) updates.enabledMcpServers = enabledMcpServers;
    if (overallRequirements !== undefined) updates.overallRequirements = overallRequirements;
    if (crmRoadmap !== undefined) updates.crmRoadmap = crmRoadmap;
    if (projectContext !== undefined) updates.projectContext = projectContext;
    if (plannedTools !== undefined) updates.plannedTools = plannedTools;
    if (status !== undefined) updates.status = status;
    if (archived !== undefined) updates.archived = archived;
    if (tags !== undefined) updates.tags = tags;
    
    const updatedProject = await updateProject(projectId, updates);
    if (!updatedProject) {
      return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
    }

    // Log the update activity
    await logActivity(
      projectId,
      'settings_update',
      `Project context updated by ${session?.user?.name || 'System User'}`,
      { 
        hasOverallRequirements: overallRequirements !== undefined,
        hasCrmRoadmap: crmRoadmap !== undefined,
        hasProjectContext: projectContext !== undefined,
        hasPlannedTools: plannedTools !== undefined,
        status: status ?? null
      }
    );
    
    return NextResponse.json({ project: updatedProject });
  } catch (error: any) {
    console.error("API PUT Project Update Error:", error);
    return NextResponse.json({ error: error.message || "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: projectId } = await params;
    const result = await deleteProject(projectId);

    if (!result.success) {
      const status = result.error === 'Project not found' ? 404 : 500;
      return NextResponse.json(
        {
          error: `Project delete incomplete. Failed at ${result.failedAt}: ${result.error}. Completed: [${result.completed.join(', ') || 'none'}]. Leftover: [${result.leftover.join(', ')}].`,
          result,
        },
        { status }
      );
    }

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('API DELETE Project Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete project' },
      { status: 500 }
    );
  }
}
