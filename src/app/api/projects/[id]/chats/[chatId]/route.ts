import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getChat, updateChat, deleteChat } from '@/lib/project-service';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; chatId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: projectId, chatId } = await params;
    const chat = await getChat(projectId, chatId);
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    return NextResponse.json({ chat });
  } catch (error: any) {
    console.error('API GET Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch chat' }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; chatId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const chatId = resolvedParams.chatId;
    const { title, messages, summary } = await req.json();

    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (messages !== undefined) updates.messages = messages;
    if (summary !== undefined) updates.summary = summary;

    const chat = await updateChat(projectId, chatId, updates);
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    return NextResponse.json({ chat });
  } catch (error: any) {
    console.error('API PUT Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update chat' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; chatId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const chatId = resolvedParams.chatId;

    const success = await deleteChat(projectId, chatId);
    if (!success) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API DELETE Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete chat' }, { status: 500 });
  }
}
