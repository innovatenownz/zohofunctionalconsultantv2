import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getActivityLogs } from '@/lib/project-service';

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
    
    const logs = await getActivityLogs(projectId);

    
    return NextResponse.json({ logs });
  } catch (error: any) {
    console.error("API GET Project Logs Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch logs" }, { status: 500 });
  }
}
