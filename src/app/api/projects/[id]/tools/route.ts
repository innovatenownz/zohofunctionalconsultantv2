import { NextResponse } from 'next/server';
import { getProject } from '@/lib/project-service';
import { listAllMCPTools } from '@/lib/agents/mcp-agent';
import { getSession } from '@/lib/auth';

export async function GET(
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
    
    const project = await getProject(projectId);

    
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let mcpServersConfig = null;
    if (project.mcpConfig) {
      if (typeof project.mcpConfig === 'string') {
        try {
          mcpServersConfig = JSON.parse(project.mcpConfig);
        } catch (e) {
          console.error("Failed to parse project.mcpConfig string:", e);
        }
      } else {
        mcpServersConfig = JSON.parse(JSON.stringify(project.mcpConfig));
      }
    }
    
    // Fallback to legacy mcpServers if mcpConfig is missing or empty
    if (!mcpServersConfig || (typeof mcpServersConfig === 'object' && Object.keys(mcpServersConfig).length === 0)) {
      mcpServersConfig = project.mcpServers;
    }
    
    if (!mcpServersConfig || (Array.isArray(mcpServersConfig) && mcpServersConfig.length === 0) || (typeof mcpServersConfig === 'object' && !Array.isArray(mcpServersConfig) && Object.keys(mcpServersConfig).length === 0)) {
       return NextResponse.json({ tools: [] });
    }

    // Filter by enabled servers if enabledMcpServers is present
    if (project.enabledMcpServers && mcpServersConfig.mcpServers) {
      const filtered: Record<string, any> = {};
      for (const name of project.enabledMcpServers) {
        if (mcpServersConfig.mcpServers[name]) {
          filtered[name] = mcpServersConfig.mcpServers[name];
        }
      }
      mcpServersConfig.mcpServers = filtered;
    }
    
    const tools = await listAllMCPTools(mcpServersConfig, projectId);
    
    return NextResponse.json({ tools });
  } catch (error: any) {
    console.error("API GET MCP Tools Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch tools" }, { status: 500 });
  }
}
