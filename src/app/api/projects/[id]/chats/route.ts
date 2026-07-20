import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listChats, createChat } from '@/lib/project-service';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const chats = await listChats(projectId);
    return NextResponse.json({ chats });
  } catch (error: any) {
    console.error('API GET Chats Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch chats' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const { title } = await req.json().catch(() => ({ title: undefined }));
    const chat = await createChat(projectId, title);
    return NextResponse.json({ chat });
  } catch (error: any) {
    console.error('API POST Chats Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create chat' }, { status: 500 });
  }
}
