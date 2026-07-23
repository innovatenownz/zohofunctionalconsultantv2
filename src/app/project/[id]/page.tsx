'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import A2UIWidget from '@/app/components/A2UIWidget';
import { apiFetch, ApiError, getUserMessage, handleApiError } from '@/app/lib/api-client';
import { getUnionMcpServerNames } from '@/lib/mcp-server-names';

type Message = {
  role: 'user' | 'agent';
  content: string;
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  timestamp?: number;
  attachments?: Array<{ name: string; size: number }>;
};

export default function ProjectPage() {
  const params = useParams();
  const projectId = params?.id as string || 'default-project';
  const [projectName, setProjectName] = useState('');

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [isChatLoaded, setIsChatLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { data: session } = useSession();

  // Multi-Chat States
  const [chatSessions, setChatSessions] = useState<any[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isEditingChatTitle, setIsEditingChatTitle] = useState(false);
  const [editChatTitleVal, setEditChatTitleVal] = useState('');

  // Auto-scroll & File Attachments Refs/State
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; size: number; type: string; content: string }>>([]);

  // Progress Stream State
  const [streamingStatus, setStreamingStatus] = useState('');
  const isLoadingRef = useRef(false);

  // MCP & Drive Settings
  const [mcpConfigText, setMcpConfigText] = useState('{\n  "mcpServers": {\n  }\n}');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [enabledMcpServers, setEnabledMcpServers] = useState<string[]>([]);
  const [mcpCredentialServerNames, setMcpCredentialServerNames] = useState<string[]>([]);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  // Add Server Form State
  const searchParams = useSearchParams();
  const [showAddServerForm, setShowAddServerForm] = useState(false);
  const [editingServerName, setEditingServerName] = useState<string | null>(null);
  const [addServerTab, setAddServerTab] = useState<'url' | 'json' | 'config'>('url');
  const [newServerForm, setNewServerForm] = useState({
    name: '',
    transport: 'sse', // 'sse' or 'stdio'
    url: '',
    command: '',
    args: ''
  });
  const [newServerCredentialsJson, setNewServerCredentialsJson] = useState('');
  const [newServerConfigJson, setNewServerConfigJson] = useState('{\n  "url": ""\n}');
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [oauthToast, setOauthToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showDeleteProjectModal, setShowDeleteProjectModal] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const notify = (message: string, type: 'success' | 'error' = 'error') => {
    setOauthToast({ type, message });
  };

  const triggerSignIn = () => signIn('google');

  const parseMcpConfigOrNotify = (): Record<string, unknown> | null => {
    try {
      return JSON.parse(mcpConfigText);
    } catch {
      notify('Invalid JSON in MCP Configuration');
      return null;
    }
  };

  const putProjectSettings = async (body: Record<string, unknown>) => {
    await apiFetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  const applyProjectMcpState = (project: any) => {
    if (project.enabledMcpServers) {
      setEnabledMcpServers(project.enabledMcpServers);
    }
    if (Array.isArray(project.mcpCredentialServerNames)) {
      setMcpCredentialServerNames(project.mcpCredentialServerNames);
    }
    if (project.mcpConfig) {
      try {
        const configStr =
          typeof project.mcpConfig === 'string'
            ? project.mcpConfig
            : JSON.stringify(project.mcpConfig, null, 2);
        setMcpConfigText(configStr);

        if (!project.enabledMcpServers && project.mcpConfig.mcpServers) {
          setEnabledMcpServers(Object.keys(project.mcpConfig.mcpServers));
        }
      } catch {
        /* ignore */
      }
    } else if (project.mcpServers && Array.isArray(project.mcpServers)) {
      const configObj: any = { mcpServers: {} };
      project.mcpServers.forEach((s: any, i: number) => {
        configObj.mcpServers[s.name || `server_${i}`] = { url: s.url };
      });
      setMcpConfigText(JSON.stringify(configObj, null, 2));
      if (!project.enabledMcpServers) {
        setEnabledMcpServers(Object.keys(configObj.mcpServers));
      }
    }
    if (project.selectedTools) {
      setSelectedTools(project.selectedTools);
    }
    if (project.driveFolderId) setDriveFolderId(project.driveFolderId);
  };

  const refetchProjectMcpState = async () => {
    const res = await apiFetch(`/api/projects/${projectId}`);
    const data = await res.json();
    if (data.project) {
      applyProjectMcpState(data.project);
    }
  };

  // Tools State
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);

  // Specifications State
  const [isEditingSpecs, setIsEditingSpecs] = useState(false);
  const [isSavingSpecs, setIsSavingSpecs] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [specs, setSpecs] = useState({
    overallRequirements: '',
    crmRoadmap: '',
    projectContext: '',
    plannedTools: ''
  });
  const [editedSpecs, setEditedSpecs] = useState({
    overallRequirements: '',
    crmRoadmap: '',
    projectContext: '',
    plannedTools: ''
  });

  const [activeTab, setActiveTab] = useState<'history' | 'settings'>('history');
  const [logs, setLogs] = useState<any[]>([]);

  // Load project details & specifications
  useEffect(() => {
    async function fetchProject() {
      try {
        const res = await apiFetch(`/api/projects/${projectId}`);
        const data = await res.json();
        if (data.project) {
            setProjectName(data.project.name || '');
            const loadedSpecs = {
              overallRequirements: data.project.overallRequirements || '',
              crmRoadmap: data.project.crmRoadmap || '',
              projectContext: data.project.projectContext || '',
              plannedTools: data.project.plannedTools || ''
            };
            setSpecs(loadedSpecs);
            setEditedSpecs(loadedSpecs);
            applyProjectMcpState(data.project);
          }
      } catch (err) {
        handleApiError(err, (message) => notify(message), triggerSignIn);
      }
    }
    fetchProject();
  }, [projectId]);

  useEffect(() => {
    if (activeTab === 'history') {
      (async () => {
        try {
          const res = await apiFetch(`/api/projects/${projectId}/logs`);
          const data = await res.json();
          if (data.logs) setLogs(data.logs);
        } catch (err) {
          handleApiError(err, (message) => notify(message), triggerSignIn);
        }
      })();
    }
  }, [activeTab, projectId]);

  // Load chat sessions
  useEffect(() => {
    async function fetchChatSessions() {
      try {
        const res = await apiFetch(`/api/projects/${projectId}/chats`);
        const data = await res.json();
        if (data.chats) {
          setChatSessions(data.chats);
          if (data.chats.length > 0) {
            setActiveChatId(data.chats[0].id);
          } else {
            await handleCreateNewChat();
          }
        }
      } catch (err) {
        handleApiError(err, (message) => notify(message), triggerSignIn);
      }
    }
    if (projectId) {
      fetchChatSessions();
    }
  }, [projectId]);

  // Load chat history of the active session from the server (Admin SDK; no direct client DB access)
  useEffect(() => {
    if (!projectId || !activeChatId) {
      if (!activeChatId) setIsChatLoaded(true);
      return;
    }

    let cancelled = false;
    setIsChatLoaded(false);

    (async () => {
      // Don't overwrite locally-streamed messages while a response is in progress
      if (isLoadingRef.current) {
        setIsChatLoaded(true);
        return;
      }
      try {
        const res = await apiFetch(`/api/projects/${projectId}/chats/${activeChatId}`);
        const data = await res.json();
        if (!cancelled) setMessages(data.chat?.messages || []);
      } catch (err) {
        if (!cancelled) handleApiError(err, (message) => notify(message), triggerSignIn);
      } finally {
        if (!cancelled) setIsChatLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, activeChatId]);

  const handleCreateNewChat = async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.chat) {
        setChatSessions(prev => [data.chat, ...prev]);
        setActiveChatId(data.chat.id);
      }
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    }
  };

  const handleRenameChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChatId || !editChatTitleVal.trim()) return;
    try {
      const res = await apiFetch(`/api/projects/${projectId}/chats/${activeChatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editChatTitleVal.trim() })
      });
      const data = await res.json();
      if (data.chat) {
        setChatSessions(prev => prev.map(c => c.id === activeChatId ? data.chat : c));
        setIsEditingChatTitle(false);
      }
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    }
  };

  const handleDeleteChat = async () => {
    if (!activeChatId) return;
    if (!confirm("Are you sure you want to delete this chat session? This action cannot be undone.")) return;
    try {
      await apiFetch(`/api/projects/${projectId}/chats/${activeChatId}`, {
        method: 'DELETE'
      });
      const remainingChats = chatSessions.filter(c => c.id !== activeChatId);
      setChatSessions(remainingChats);
      setIsEditingChatTitle(false);
      if (remainingChats.length > 0) {
        setActiveChatId(remainingChats[0].id);
      } else {
        await handleCreateNewChat();
      }
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    }
  };

  // Handle OAuth redirect success toast
  useEffect(() => {
    if (searchParams) {
      const mcpSuccess = searchParams.get('mcp_success');
      const mcpServer = searchParams.get('server');
      if (mcpSuccess === 'true') {
        setOauthToast({
          type: 'success',
          message: mcpServer
            ? `Successfully connected and authenticated MCP Server: ${mcpServer}`
            : 'Successfully connected and authenticated MCP Server.',
        });

        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);

        void refetchProjectMcpState();

        setTimeout(() => {
          handleFetchTools();
        }, 1500);
      }
    }
  }, [searchParams]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
 
  useEffect(() => {
    if (isChatLoaded) {
      setTimeout(scrollToBottom, 100);
    }
  }, [messages, isChatLoaded]);
 
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
 
    Array.from(files).forEach(file => {
      const isTextOrCsv = file.type.startsWith('text/') || 
                          file.name.endsWith('.csv') || 
                          file.name.endsWith('.json') || 
                          file.name.endsWith('.md') ||
                          file.name.endsWith('.txt');
      
      if (!isTextOrCsv) {
        notify(`File format of "${file.name}" is not supported. Please upload plain text, CSV, JSON, or Markdown files.`);
        return;
      }
 
      const reader = new FileReader();
      reader.onload = (event) => {
        const textContent = event.target?.result as string;
        setAttachedFiles(prev => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            type: file.type,
            content: textContent
          }
        ]);
      };
      reader.readAsText(file);
    });
 
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOAuthInitiate = async () => {
    const serverName = newServerForm.name.trim();
    const serverUrl = newServerForm.url.trim();
    if (!serverName || !serverUrl) {
      notify('Please provide both Server Name and SSE Endpoint URL.');
      return;
    }
    setIsAddingServer(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/oauth/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, serverUrl }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
      setIsAddingServer(false);
    }
  };

  const handleManualCredentialsSubmit = async () => {
    const serverName = newServerForm.name.trim();
    const serverUrl = newServerForm.url.trim();
    const credentialsJson = newServerCredentialsJson.trim();
    if (!serverName || !credentialsJson) {
      notify('Please enter Server Name and paste the Credentials JSON.');
      return;
    }
    try {
      JSON.parse(credentialsJson);
    } catch {
      notify('Credentials payload is not valid JSON.');
      return;
    }
    setIsAddingServer(true);
    try {
      await apiFetch(`/api/projects/${projectId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, serverUrl: serverUrl || null, credentialsJson }),
      });
      notify('Credentials verified and saved successfully!', 'success');
      window.location.reload();
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    } finally {
      setIsAddingServer(false);
    }
  };

  const handleRawConfigSubmit = async () => {
    const serverName = newServerForm.name.trim();
    const configJson = newServerConfigJson.trim();
    if (!serverName || !configJson) {
      notify('Please enter Server Name and paste the configuration JSON.');
      return;
    }
    let parsedServerConfig = null;
    try {
      parsedServerConfig = JSON.parse(configJson);
    } catch {
      notify('Server Configuration is not valid JSON.');
      return;
    }
    setIsAddingServer(true);
    try {
      let parsedConfig: any = { mcpServers: {} };
      try {
        parsedConfig = JSON.parse(mcpConfigText);
      } catch {}

      if (!parsedConfig.mcpServers) parsedConfig.mcpServers = {};
      parsedConfig.mcpServers[serverName] = parsedServerConfig;

      const updatedMcpConfigText = JSON.stringify(parsedConfig, null, 2);
      setMcpConfigText(updatedMcpConfigText);
      
      const updatedEnabledServers = [...enabledMcpServers];
      if (!updatedEnabledServers.includes(serverName)) {
        updatedEnabledServers.push(serverName);
      }
      setEnabledMcpServers(updatedEnabledServers);

      await putProjectSettings({
        mcpConfig: parsedConfig,
        driveFolderId,
        selectedTools,
        enabledMcpServers: updatedEnabledServers
      });

      setShowAddServerForm(false);
      setNewServerForm({ name: '', transport: 'sse', url: '', command: '', args: '' });
      setNewServerCredentialsJson('');
      setNewServerConfigJson('{\n  "url": ""\n}');

      handleFetchTools();
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    } finally {
      setIsAddingServer(false);
    }
  };

  const handleEditServer = (serverName: string, serverInfo: any) => {
    setEditingServerName(serverName);
    setShowAddServerForm(true);

    const info = serverInfo || {};

    // Determine server type/tab
    if (info.url) {
      setNewServerForm({
        name: serverName,
        transport: 'sse',
        url: info.url || '',
        command: '',
        args: ''
      });
      setNewServerConfigJson(JSON.stringify(info, null, 2));
      setAddServerTab('url');
    } else if (info.command) {
      setAddServerTab('config');
      setNewServerForm({
        name: serverName,
        transport: 'stdio',
        url: '',
        command: info.command || '',
        args: Array.isArray(info.args) ? info.args.join(' ') : ''
      });
      setNewServerConfigJson(JSON.stringify(info, null, 2));
    } else {
      setAddServerTab('url');
      setNewServerForm({
        name: serverName,
        transport: 'sse',
        url: '',
        command: '',
        args: ''
      });
      setNewServerConfigJson('{}');
    }

    // Scroll smoothly to the form
    setTimeout(() => {
      const element = document.getElementById('add-server-form-container');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  };

  const handleDeleteServer = async (serverName: string) => {
    if (
      !confirm(
        `Are you sure you want to remove the connection "${serverName}"? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const res = await apiFetch(`/api/projects/${projectId}/credentials`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName }),
      });
      const data = await res.json();

      if (data.project) {
        applyProjectMcpState(data.project);
      } else {
        await refetchProjectMcpState();
      }

      const toolsToRemove = availableTools
        .filter((t) => t.serverName === serverName)
        .map((t) => t.name);
      const updatedSelectedTools = selectedTools.filter((t) => !toolsToRemove.includes(t));
      setSelectedTools(updatedSelectedTools);

      if (editingServerName === serverName) {
        setShowAddServerForm(false);
        setEditingServerName(null);
      }
      if (expandedServer === serverName) {
        setExpandedServer(null);
      }

      setTimeout(() => {
        handleFetchTools();
      }, 500);

      notify(`Successfully removed MCP connection "${serverName}".`, 'success');
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    }
  };

  const handleDeleteProject = async () => {
    if (deleteConfirmName !== projectName || !projectName) return;
    setIsDeletingProject(true);
    try {
      await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      window.location.href = '/';
    } catch (err) {
      const message =
        err instanceof ApiError && err.message
          ? err.message
          : 'Failed to delete project.';
      notify(message);
      setIsDeletingProject(false);
    }
  };

  const handleSaveSpecs = async () => {
    setIsSavingSpecs(true);
    try {
      await putProjectSettings(editedSpecs);
      setSpecs(editedSpecs);
      setIsEditingSpecs(false);
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    } finally {
      setIsSavingSpecs(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSpecs(true);
    try {
      const parsedConfig = parseMcpConfigOrNotify();
      if (!parsedConfig) return;
      await putProjectSettings({ mcpConfig: parsedConfig, driveFolderId, selectedTools, enabledMcpServers });
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    } finally {
      setIsSavingSpecs(false);
    }
  };

  const handleFetchTools = async () => {
    setToolsLoading(true);
    try {
      const parsedConfig = parseMcpConfigOrNotify();
      if (!parsedConfig) return;
      await putProjectSettings({ mcpConfig: parsedConfig, driveFolderId, selectedTools, enabledMcpServers });
      const res = await apiFetch(`/api/projects/${projectId}/tools`);
      const data = await res.json();
      if (data.tools) setAvailableTools(data.tools);
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    } finally {
      setToolsLoading(false);
    }
  };

  const handleSyncDrive = async () => {
    setIsSyncing(true);
    try {
      await apiFetch(`/api/projects/${projectId}/sync`, { method: 'POST' });
      const pRes = await apiFetch(`/api/projects/${projectId}`);
      const data = await pRes.json();
      if (data.project) {
         setSpecs(prev => ({
           ...prev,
           overallRequirements: data.project.overallRequirements || prev.overallRequirements,
           crmRoadmap: data.project.crmRoadmap || prev.crmRoadmap,
           projectContext: data.project.projectContext || prev.projectContext,
           plannedTools: data.project.plannedTools || prev.plannedTools,
         }));
      }
    } catch (err) {
      handleApiError(err, (message) => notify(message), triggerSignIn);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isLoading || !activeChatId) return;
    
    const userMessage: Message = { 
      role: 'user', 
      content: input.trim() || (attachedFiles.length > 0 ? `[Uploaded ${attachedFiles.length} file(s)]` : ''),
      user: {
        name: session?.user?.name,
        email: session?.user?.email,
        image: session?.user?.image
      },
      timestamp: Date.now(),
      attachments: attachedFiles.map(f => ({ name: f.name, size: f.size }))
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    const filesToSend = [...attachedFiles];
    setAttachedFiles([]);
    setIsLoading(true);
    isLoadingRef.current = true;
    setStreamingStatus('Reading requirements and preparing request...');
    
    let mcpServersData = null;
    try {
      mcpServersData = JSON.parse(mcpConfigText);
    } catch {
      // ignore
    }
    
    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          projectId: projectId,
          mcpServers: mcpServersData,
          driveFolderId: driveFolderId,
          chatHistory: messages,
          chatId: activeChatId,
          attachments: filesToSend
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        throw new ApiError('server', 'Readable stream not supported');
      }

      let agentContent = '';
      
      // Append an empty agent message to update dynamically
      setMessages(prev => [...prev, { role: 'agent', content: '', timestamp: Date.now() }]);

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.type === 'status') {
                setStreamingStatus(data.message);
              } else if (data.type === 'content') {
                agentContent += data.delta;
                setMessages(prev => {
                  const next = [...prev];
                  if (next.length > 0) {
                    next[next.length - 1] = {
                      ...next[next.length - 1],
                      content: agentContent
                    };
                  }
                  return next;
                });
              }
            } catch (err) {
              console.warn('Failed to parse SSE line', line, err);
            }
          }
        }
      }

      // Agent message is persisted server-side by /api/chat (Admin SDK).
    } catch (error) {
      console.error(error);
      const friendlyMessage = error instanceof ApiError
        ? getUserMessage(error.kind)
        : getUserMessage('server');
      if (error instanceof ApiError && error.kind === 'unauthorized') {
        notify(friendlyMessage);
        setTimeout(() => triggerSignIn(), 1500);
      }
      const errorMsg: Message = { role: 'agent', content: friendlyMessage, timestamp: Date.now() };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
      setStreamingStatus('');
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--header-height) - 4rem)', padding: '1rem', boxSizing: 'border-box' }}>
      {showDeleteProjectModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-project-title"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'var(--overlay-scrim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem'
          }}
        >
          <div style={{
            width: '100%', maxWidth: '440px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1.25rem',
            display: 'flex', flexDirection: 'column', gap: '0.85rem'
          }}>
            <h3 id="delete-project-title" style={{ margin: 0, color: 'var(--danger-color)' }}>
              Delete project permanently?
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              This permanently removes chats, MCP credentials, and activity logs for
              <strong> {projectName || projectId}</strong>. Any changes already made in the
              client&apos;s real Zoho account are <strong>not</strong> rolled back. This cannot be undone.
            </p>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Type the project name <strong>{projectName}</strong> to confirm
              <input
                className="form-input"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={projectName || 'Project name'}
                autoFocus
                style={{ marginTop: '0.35rem', width: '100%' }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isDeletingProject}
                onClick={() => setShowDeleteProjectModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingProject || deleteConfirmName !== projectName || !projectName}
                onClick={handleDeleteProject}
                style={{
                  color: 'var(--text-on-accent)',
                  background: deleteConfirmName === projectName && projectName ? 'var(--danger-color)' : 'var(--bg-tertiary)',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: deleteConfirmName === projectName && projectName ? 'pointer' : 'not-allowed',
                  opacity: deleteConfirmName === projectName && projectName ? 1 : 0.5
                }}
              >
                {isDeletingProject ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
      {oauthToast && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          marginBottom: '1rem',
          backgroundColor: oauthToast.type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
          color: oauthToast.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)',
          border: `1px solid ${oauthToast.type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          animation: 'fade-in 0.3s ease'
        }}>
          <span style={{ fontWeight: '500' }}>{oauthToast.message}</span>
          <button 
            onClick={() => setOauthToast(null)} 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'inherit', 
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '1rem',
              marginLeft: '1rem'
            }}
          >
            ✕
          </button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <a href="/" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textDecoration: 'none' }}>Projects</a>
            <span style={{ color: 'var(--text-secondary)' }}>/</span>
            <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>Project {projectName || projectId}</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', margin: 0 }}>{projectName || projectId}</h1>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button 
            className="btn btn-secondary" 
            onClick={handleSyncDrive}
            disabled={isSyncing}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {isSyncing ? (
              <span className="sync-spinner" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid var(--text-secondary)', borderTopColor: 'var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
            )}
            {isSyncing ? 'Syncing...' : 'Sync Drive'}
          </button>
        </div>
      </div>

      <div className="workspace-layout">
        {/* LEFT PANE: Chat */}
        <div className="pane-left card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ 
            padding: '0.75rem 1.25rem', 
            borderBottom: '1px solid var(--border-color)', 
            background: 'var(--bg-tertiary)', 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            minHeight: '57px',
            boxSizing: 'border-box'
          }}>
            <span style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              Consultant Chat
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success-color)' }}></div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Agent Connected</span>
            </div>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {!isChatLoaded ? (
              <div style={{ padding: '1rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Loading chat history...</div>
            ) : (
              messages.map((msg, i) => {
                // Pre-parse the message to associate mcp commands with json outputs
                const commandMatch = msg.content.match(/```mcp-command\n([\s\S]*?)```/);
                let commandObj = null;
                if (commandMatch) {
                  try {
                    commandObj = JSON.parse(commandMatch[1]);
                  } catch {}
                }
 
                return (
                  <div key={i} style={{ 
                    display: 'flex', 
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    gap: '0.25rem'
                  }}>
                    {msg.role === 'user' && msg.user?.name && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '0 0.25rem' }}>
                        {msg.user.name}
                      </span>
                    )}
                    <div 
                      className={msg.role === 'agent' ? 'markdown-content' : undefined}
                      style={{ 
                        maxWidth: msg.role === 'user' ? '85%' : '100%', 
                        padding: msg.role === 'user' ? '0.75rem 1.1rem' : '0.5rem 0', 
                        borderRadius: '12px',
                        background: msg.role === 'user' ? 'var(--accent-gradient)' : 'transparent',
                        color: msg.role === 'user' ? 'var(--text-on-accent)' : 'var(--text-primary)',
                        borderBottomRightRadius: msg.role === 'user' ? '4px' : '12px',
                        borderBottomLeftRadius: msg.role === 'agent' ? '4px' : '12px',
                        overflowX: 'auto',
                        width: '100%'
                      }}
                    >
                      {msg.role === 'user' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                              {msg.attachments.map((file, idx) => (
                                <div key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'var(--chip-bg)', padding: '0.2rem 0.5rem', borderRadius: '6px', fontSize: '0.75rem' }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                  <span style={{ color: 'var(--text-on-accent)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <ReactMarkdown
                          components={{
                            pre({ children }: any) {
                              return <div style={{ marginBottom: '1rem', width: '100%' }}>{children}</div>;
                            },
                            code({ inline, className, children, ...props }: any) {
                              const match = /language-(\w+)/.exec(className || '');
                              const codeString = String(children).replace(/\n$/, '');
                              
                              if (!inline && match) {
                                // Intercept and hide command blocks
                                if (match[1] === 'mcp-command') {
                                  return null;
                                }
                                
                                // Intercept and format json output blocks with the A2UI widget
                                if (match[1] === 'json') {
                                  return <A2UIWidget jsonString={codeString} commandContext={commandObj} />;
                                }
                              }
                              
                              const isShortSingleLine = !codeString.includes('\n') && codeString.length < 60;
                              if (isShortSingleLine) {
                                return (
                                  <code 
                                    className={className} 
                                    {...props} 
                                    style={{ 
                                      background: 'var(--bg-tertiary)', 
                                      padding: '0.2rem 0.45rem', 
                                      borderRadius: '6px', 
                                      color: 'var(--accent-color)', 
                                      fontSize: '0.85em',
                                      fontFamily: 'monospace',
                                      border: '1px solid var(--border-color)',
                                      display: 'inline-block',
                                      margin: '0.1rem 0.2rem',
                                      verticalAlign: 'middle',
                                      fontWeight: '500'
                                    }}
                                  >
                                    {codeString}
                                  </code>
                                );
                              }
                              
                              return inline ? (
                                <code 
                                  className={className} 
                                  {...props} 
                                  style={{ 
                                    background: 'var(--bg-primary)', 
                                    padding: '0.2em 0.4em', 
                                    borderRadius: '4px', 
                                    color: '#fbbf24', 
                                    fontSize: '0.85em',
                                    fontFamily: 'monospace'
                                  }}
                                >
                                  {children}
                                </code>
                              ) : (
                                <pre style={{
                                  background: 'var(--bg-primary)',
                                  padding: '1rem',
                                  borderRadius: '8px',
                                  overflowX: 'auto',
                                  border: '1px solid var(--border-color)',
                                  margin: 0
                                }}>
                                  <code className={className} {...props}>
                                    {children}
                                  </code>
                                </pre>
                              );
                            }
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      )}
                    </div>
                  </div>
                );
              })
            )}
 
            {isLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-color)', maxWidth: '400px', margin: '1rem 0' }}>
                <span className="sync-spinner" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid var(--text-secondary)', borderTopColor: 'var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: '500' }}>
                  {streamingStatus || 'Consultant agent is thinking...'}
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {attachedFiles.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {attachedFiles.map((file, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-tertiary)', padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style={{ color: 'var(--text-primary)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>({(file.size / 1024).toFixed(1)} KB)</span>
                    <button type="button" onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))} style={{ color: 'var(--danger-color)', padding: '0.1rem', cursor: 'pointer', fontWeight: 'bold', border: 'none', background: 'transparent' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            
            <form onSubmit={handleSend} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button 
                type="button" 
                title="Attach Document/Data File"
                onClick={() => fileInputRef.current?.click()}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.4rem', display: 'flex', alignItems: 'center' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect} 
                style={{ display: 'none' }} 
                multiple
              />
              
              <input 
                type="text" 
                className="form-input" 
                placeholder="Instruct the agent on configuration or integration..." 
                value={input}
                onChange={e => setInput(e.target.value)}
                style={{ flex: 1, margin: 0 }}
                disabled={isLoading}
              />
              <button type="submit" className="btn btn-primary" style={{ padding: '0.6rem 1.5rem' }} disabled={isLoading}>
                {isLoading ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT PANE: Settings and History */}
        <div className="pane-right card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
            <button 
              onClick={() => setActiveTab('history')} 
              style={{ flex: 1, padding: '1rem', fontWeight: '600', borderBottom: activeTab === 'history' ? '2px solid var(--accent-color)' : '2px solid transparent', color: activeTab === 'history' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              History
            </button>
            <button 
              onClick={() => setActiveTab('settings')} 
              style={{ flex: 1, padding: '1rem', fontWeight: '600', borderBottom: activeTab === 'settings' ? '2px solid var(--accent-color)' : '2px solid transparent', color: activeTab === 'settings' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              Settings & Context
            </button>
          </div>

          {activeTab === 'settings' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* SPECIFICATIONS SECTION */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Specifications</h2>
                  {isEditingSpecs ? (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-secondary" onClick={() => { setIsEditingSpecs(false); setEditedSpecs(specs); }} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>Cancel</button>
                      <button className="btn btn-primary" onClick={handleSaveSpecs} disabled={isSavingSpecs} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
                        {isSavingSpecs ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-secondary" onClick={() => setIsEditingSpecs(true)} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>Edit Specs</button>
                  )}
                </div>
                
                <details open style={{ background: 'var(--bg-tertiary)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--accent-color)', outline: 'none' }}>
                    📁 View & Edit Context
                  </summary>
                  <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* OVERALL REQUIREMENTS */}
                    <div>
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>Overall Requirements</h3>
                      {isEditingSpecs ? (
                        <textarea 
                          className="form-input"
                          rows={4}
                          value={editedSpecs.overallRequirements}
                          onChange={e => setEditedSpecs({...editedSpecs, overallRequirements: e.target.value})}
                          style={{ width: '100%', resize: 'vertical' }}
                        />
                      ) : (
                        <div className="markdown-content">
                          <ReactMarkdown>{specs.overallRequirements || 'No requirements specified.'}</ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* PRODUCT ROADMAP */}
                    <div>
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>Product & Integration Roadmap</h3>
                      {isEditingSpecs ? (
                        <textarea 
                          className="form-input"
                          rows={6}
                          value={editedSpecs.crmRoadmap}
                          onChange={e => setEditedSpecs({...editedSpecs, crmRoadmap: e.target.value})}
                          style={{ width: '100%', resize: 'vertical' }}
                        />
                      ) : (
                        <div className="markdown-content">
                          <ReactMarkdown>{specs.crmRoadmap || 'No roadmap specified.'}</ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* PROJECT CONTEXT */}
                    <div>
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>Project Context</h3>
                      {isEditingSpecs ? (
                        <textarea 
                          className="form-input"
                          rows={3}
                          value={editedSpecs.projectContext}
                          onChange={e => setEditedSpecs({...editedSpecs, projectContext: e.target.value})}
                          style={{ width: '100%', resize: 'vertical' }}
                        />
                      ) : (
                        <div className="markdown-content">
                          <ReactMarkdown>{specs.projectContext || 'No project context specified.'}</ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* PLANNED TOOLS */}
                    <div>
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>Planned Tools</h3>
                      {isEditingSpecs ? (
                        <textarea 
                          className="form-input"
                          rows={3}
                          value={editedSpecs.plannedTools}
                          onChange={e => setEditedSpecs({...editedSpecs, plannedTools: e.target.value})}
                          style={{ width: '100%', resize: 'vertical' }}
                        />
                      ) : (
                        <div className="markdown-content">
                          <ReactMarkdown>{specs.plannedTools || 'No planned tools specified.'}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                </details>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0' }} />

              {/* INTEGRATIONS SECTION */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h2 style={{ fontSize: '1.25rem', margin: 0, marginBottom: '0.5rem' }}>Integrations & Settings</h2>
                
                <details style={{ background: 'var(--bg-tertiary)', padding: '1.5rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--accent-color)', outline: 'none' }}>
                    ⚙️ View & Edit Settings
                  </summary>
                  <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    
                    <div className="form-group">
                      <label className="form-label">Google Drive Folder ID</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        value={driveFolderId} 
                        onChange={e => setDriveFolderId(e.target.value)} 
                        placeholder="e.g., 1A2b3C4d5E6f7G8h9I0j"
                      />
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                        The consultant retrieves docs and meeting notes from this Drive folder for context.
                      </p>
                    </div>

                    {/* CONNECTED MCP SERVERS & TOGGLES */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <label className="form-label" style={{ margin: 0 }}>MCP Server Connections</label>
                        <button 
                          className="btn btn-secondary" 
                          onClick={() => {
                            if (showAddServerForm) {
                              setShowAddServerForm(false);
                              setEditingServerName(null);
                              setNewServerForm({ name: '', transport: 'sse', url: '', command: '', args: '' });
                              setNewServerCredentialsJson('');
                              setNewServerConfigJson('{\n  "url": ""\n}');
                            } else {
                              setShowAddServerForm(true);
                              setEditingServerName(null);
                            }
                          }}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                        >
                          {showAddServerForm ? 'Cancel' : '+ Add Server'}
                        </button>
                      </div>

                      {/* ADD SERVER FORM */}
                      {showAddServerForm && (
                        <div id="add-server-form-container" style={{
                          background: 'var(--glass-bg)',
                          backdropFilter: 'blur(12px)',
                          padding: '1.5rem',
                          borderRadius: '12px',
                          border: '1px solid var(--glass-border)',
                          boxShadow: 'var(--glass-shadow)',
                          marginBottom: '1.5rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '1rem',
                          transition: 'all 0.3s ease'
                        }}>
                          <style>{`
                            @keyframes mcp-spin {
                              0% { transform: rotate(0deg); }
                              100% { transform: rotate(360deg); }
                            }
                          `}</style>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0, fontWeight: '600', letterSpacing: '0.5px' }}>
                              {editingServerName ? `Edit MCP Server: ${editingServerName}` : 'Add MCP Server Connection'}
                            </h4>
                            {editingServerName && (
                              <button
                                type="button"
                                onClick={() => handleDeleteServer(editingServerName)}
                                style={{
                                  color: 'var(--danger-color)',
                                  fontSize: '0.75rem',
                                  padding: '0.25rem 0.5rem',
                                  border: '1px solid var(--danger-color)',
                                  borderRadius: '6px',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                }}
                              >
                                Remove Connection
                              </button>
                            )}
                          </div>

                          {/* Tab Headers */}
                          <div style={{ 
                            display: 'flex', 
                            background: 'var(--inset-bg)', 
                            padding: '0.25rem', 
                            borderRadius: '8px', 
                            border: '1px solid var(--border-color)' 
                          }}>
                            <button
                              type="button"
                              style={{
                                flex: 1,
                                padding: '0.5rem',
                                background: addServerTab === 'url' ? 'var(--chip-bg)' : 'transparent',
                                border: 'none',
                                borderRadius: '6px',
                                color: addServerTab === 'url' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: addServerTab === 'url' ? '600' : 'normal',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                transition: 'all 0.2s ease',
                                outline: 'none'
                              }}
                              onClick={() => setAddServerTab('url')}
                            >
                              🌐 URL (OAuth)
                            </button>
                            <button
                              type="button"
                              style={{
                                flex: 1,
                                padding: '0.5rem',
                                background: addServerTab === 'json' ? 'var(--chip-bg)' : 'transparent',
                                border: 'none',
                                borderRadius: '6px',
                                color: addServerTab === 'json' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: addServerTab === 'json' ? '600' : 'normal',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                transition: 'all 0.2s ease',
                                outline: 'none'
                              }}
                              onClick={() => setAddServerTab('json')}
                            >
                              🔑 JSON (Credentials)
                            </button>
                            <button
                              type="button"
                              style={{
                                flex: 1,
                                padding: '0.5rem',
                                background: addServerTab === 'config' ? 'var(--chip-bg)' : 'transparent',
                                border: 'none',
                                borderRadius: '6px',
                                color: addServerTab === 'config' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: addServerTab === 'config' ? '600' : 'normal',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                transition: 'all 0.2s ease',
                                outline: 'none'
                              }}
                              onClick={() => setAddServerTab('config')}
                            >
                              ⚙️ JSON Code (Raw Config)
                            </button>
                          </div>

                          {/* Common Input: Server Name */}
                          <div className="form-group" style={{ margin: 0 }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                              Server Identifier / Name
                            </label>
                            <input 
                              type="text" 
                              placeholder="e.g. zoho-crm"
                              className="form-input"
                              value={newServerForm.name}
                              onChange={e => setNewServerForm({...newServerForm, name: e.target.value})}
                              disabled={!!editingServerName}
                              style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', background: 'var(--inset-bg)', border: '1px solid var(--border-color)' }}
                            />
                          </div>

                          {/* Tab-Specific Panels */}
                          {addServerTab === 'url' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                              <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                                  SSE Endpoint URL
                                </label>
                                <input 
                                  type="text" 
                                  placeholder="e.g. https://crm-mcp.zoho.com/sse"
                                  className="form-input"
                                  value={newServerForm.url}
                                  onChange={e => setNewServerForm({...newServerForm, url: e.target.value})}
                                  style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', background: 'var(--inset-bg)', border: '1px solid var(--border-color)' }}
                                />
                                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem', margin: 0 }}>
                                  This initiates Zoho Dynamic Client Registration (DCR) and redirects you to the OAuth authorization consent page.
                                </p>
                              </div>

                              <button 
                                type="button" 
                                className="btn btn-primary"
                                disabled={isAddingServer}
                                style={{ 
                                  fontSize: '0.8rem', 
                                  padding: '0.5rem 1rem', 
                                  width: '100%', 
                                  marginTop: '0.5rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.5rem'
                                }}
                                onClick={handleOAuthInitiate}
                              >
                                {isAddingServer ? (
                                  <>
                                    <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid var(--chip-bg)', borderTopColor: 'var(--text-on-accent)', borderRadius: '50%', animation: 'mcp-spin 1s linear infinite' }}></span>
                                    <span>Authorizing...</span>
                                  </>
                                ) : (
                                  <span>🌐 Authorize & Connect via OAuth</span>
                                )}
                              </button>
                            </div>
                          )}

                          {addServerTab === 'json' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                              <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                                  SSE Endpoint URL (Optional)
                                </label>
                                <input 
                                  type="text" 
                                  placeholder="e.g. https://crm-mcp.zoho.com/sse"
                                  className="form-input"
                                  value={newServerForm.url}
                                  onChange={e => setNewServerForm({...newServerForm, url: e.target.value})}
                                  style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', background: 'var(--inset-bg)', border: '1px solid var(--border-color)' }}
                                />
                              </div>

                              <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                                  Credentials JSON
                                </label>
                                <textarea 
                                  placeholder={`{\n  "clientId": "your-client-id",\n  "refreshToken": "your-refresh-token",\n  "tokenEndpoint": "https://accounts.zoho.com/oauth/v2/token",\n  "scope": "ZohoCRM.modules.ALL"\n}`}
                                  className="form-input"
                                  rows={6}
                                  value={newServerCredentialsJson}
                                  onChange={e => setNewServerCredentialsJson(e.target.value)}
                                  style={{ 
                                    fontSize: '0.75rem', 
                                    fontFamily: 'monospace', 
                                    padding: '0.5rem 0.75rem', 
                                    background: 'var(--inset-bg)', 
                                    border: '1px solid var(--border-color)',
                                    resize: 'vertical'
                                  }}
                                />
                                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem', margin: 0 }}>
                                  Paste the credentials JSON object. It must contain client ID, refresh token, and token endpoint.
                                </p>
                              </div>

                              <button 
                                type="button" 
                                className="btn btn-primary"
                                disabled={isAddingServer}
                                style={{ 
                                  fontSize: '0.8rem', 
                                  padding: '0.5rem 1rem', 
                                  width: '100%', 
                                  marginTop: '0.5rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.5rem'
                                }}
                                onClick={handleManualCredentialsSubmit}
                              >
                                {isAddingServer ? (
                                  <>
                                    <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid var(--chip-bg)', borderTopColor: 'var(--text-on-accent)', borderRadius: '50%', animation: 'mcp-spin 1s linear infinite' }}></span>
                                    <span>Verifying & Saving...</span>
                                  </>
                                ) : (
                                  <span>🔑 Save & Authenticate Credentials</span>
                                )}
                              </button>
                            </div>
                          )}

                          {addServerTab === 'config' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                              <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                                  Server Configuration JSON (Raw config block)
                                </label>
                                <textarea 
                                  placeholder={`{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-postgres"],\n  "env": {\n    "PGHOST": "localhost"\n  }\n}`}
                                  className="form-input"
                                  rows={6}
                                  value={newServerConfigJson}
                                  onChange={e => setNewServerConfigJson(e.target.value)}
                                  style={{ 
                                    fontSize: '0.75rem', 
                                    fontFamily: 'monospace', 
                                    padding: '0.5rem 0.75rem', 
                                    background: 'var(--inset-bg)', 
                                    border: '1px solid var(--border-color)',
                                    resize: 'vertical'
                                  }}
                                />
                                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem', margin: 0 }}>
                                  Paste the raw MCP server configuration block (e.g. stdio transport parameters or SSE URL configuration).
                                </p>
                              </div>

                              <button 
                                type="button" 
                                className="btn btn-primary"
                                disabled={isAddingServer}
                                style={{ 
                                  fontSize: '0.8rem', 
                                  padding: '0.5rem 1rem', 
                                  width: '100%', 
                                  marginTop: '0.5rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.5rem'
                                }}
                                onClick={handleRawConfigSubmit}
                              >
                                {isAddingServer ? (
                                  <>
                                    <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid var(--chip-bg)', borderTopColor: 'var(--text-on-accent)', borderRadius: '50%', animation: 'mcp-spin 1s linear infinite' }}></span>
                                    <span>Saving Configuration...</span>
                                  </>
                                ) : (
                                  <span>⚙️ Add Raw Configuration</span>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* MCP CONNECTIONS GRAPHICAL CARDS */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                        {(() => {
                          let configObj: any = {};
                          try {
                            configObj = JSON.parse(mcpConfigText);
                          } catch {}
                          
                          const servers = getUnionMcpServerNames(
                            configObj,
                            enabledMcpServers,
                            mcpCredentialServerNames
                          );
                          if (servers.length === 0) {
                            return (
                              <div style={{ padding: '1rem', border: '1px dashed var(--border-color)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                No MCP connections configured yet.
                              </div>
                            );
                          }

                          return servers.map((serverName) => {
                            const isEnabled = enabledMcpServers.includes(serverName);
                            const serverInfo = configObj.mcpServers?.[serverName] || null;
                            const hasStoredCredentials = mcpCredentialServerNames.includes(serverName);
                            const isExpanded = expandedServer === serverName;
                            
                            // Filter available tools that belong to this server
                            const serverTools = availableTools.filter(t => t.serverName === serverName);

                            let connectionSubtitle = 'No configuration saved';
                            if (serverInfo?.url) {
                              connectionSubtitle = `SSE: ${serverInfo.url}`;
                            } else if (serverInfo?.command) {
                              connectionSubtitle = `Stdio: ${serverInfo.command}`;
                            } else if (hasStoredCredentials) {
                              connectionSubtitle = 'OAuth credentials saved (missing mcpConfig entry)';
                            }

                            return (
                              <div key={serverName} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', background: 'var(--row-alt)', minWidth: 0 }}>
                                  <div style={{ flex: 1, minWidth: '80px' }}>
                                    <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', margin: 0, fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {serverName.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                    </h4>
                                    <div
                                      title={connectionSubtitle}
                                      style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    >
                                      {connectionSubtitle}
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                                    {/* TOGGLE SWITCH */}
                                    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
                                      <input 
                                        type="checkbox" 
                                        checked={isEnabled} 
                                        aria-label={isEnabled ? `Disable ${serverName} MCP server` : `Enable ${serverName} MCP server`}
                                        onChange={async (e) => {
                                          const checked = e.target.checked;
                                          let updatedEnabled: string[];
                                          if (checked) {
                                            updatedEnabled = [...enabledMcpServers, serverName];
                                          } else {
                                            updatedEnabled = enabledMcpServers.filter(s => s !== serverName);
                                          }
                                          setEnabledMcpServers(updatedEnabled);
                                          
                                          // Auto-save toggle immediately
                                          try {
                                            let parsedConfig = {};
                                            try {
                                              parsedConfig = JSON.parse(mcpConfigText);
                                            } catch {}
                                            await putProjectSettings({
                                              mcpConfig: parsedConfig,
                                              driveFolderId,
                                              selectedTools,
                                              enabledMcpServers: updatedEnabled
                                            });
                                          } catch (err) {
                                            handleApiError(err, (message) => notify(message), triggerSignIn);
                                          }
                                        }}
                                        style={{ opacity: 0, width: 0, height: 0 }}
                                      />
                                      <span style={{
                                        display: 'inline-block',
                                        width: '34px',
                                        height: '20px',
                                        backgroundColor: isEnabled ? 'var(--success-color)' : 'var(--bg-tertiary)',
                                        borderRadius: '20px',
                                        position: 'relative',
                                        transition: 'background-color 0.2s'
                                      }}>
                                        <span style={{
                                          display: 'block',
                                          width: '14px',
                                          height: '14px',
                                          backgroundColor: 'white',
                                          borderRadius: '50%',
                                          position: 'absolute',
                                          top: '3px',
                                          left: isEnabled ? '17px' : '3px',
                                          transition: 'left 0.2s'
                                        }} />
                                      </span>
                                    </label>

                                    {/* EDIT BUTTON */}
                                    <button 
                                      type="button" 
                                      onClick={() => handleEditServer(serverName, serverInfo)}
                                      aria-label={`Edit ${serverName} connection`}
                                      title="Edit Connection"
                                      style={{ color: 'var(--text-secondary)', padding: '0.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                                      </svg>
                                    </button>

                                    {/* DELETE BUTTON */}
                                    <button 
                                      type="button" 
                                      onClick={() => handleDeleteServer(serverName)}
                                      aria-label={`Delete ${serverName} connection`}
                                      title="Delete Connection"
                                      style={{ color: 'var(--danger-color)', padding: '0.2rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--danger-color)', borderRadius: '4px', background: 'transparent' }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                      </svg>
                                    </button>

                                    {/* COLLAPSE CHEVRON */}
                                    <button 
                                      type="button" 
                                      onClick={() => setExpandedServer(isExpanded ? null : serverName)}
                                      aria-label={isExpanded ? `Collapse ${serverName} tools` : `Expand ${serverName} tools`}
                                      aria-expanded={isExpanded}
                                      style={{ color: 'var(--text-secondary)', padding: '0.2rem' }}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                                        <polyline points="6 9 12 15 18 9" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>

                                {/* EXPANDABLE TOOL CHECKLIST */}
                                {isExpanded && (
                                  <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)', background: 'var(--inset-bg)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                      <span style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-secondary)' }}>Selected Capabilities</span>
                                      <button 
                                        type="button" 
                                        onClick={handleFetchTools}
                                        disabled={toolsLoading}
                                        style={{ color: 'var(--accent-color)', fontSize: '0.75rem', textDecoration: 'underline' }}
                                      >
                                        {toolsLoading ? 'Syncing...' : 'Reload Tools'}
                                      </button>
                                    </div>

                                    {serverTools.length === 0 ? (
                                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '0.5rem' }}>
                                        No tools discovered. Click Reload Tools above.
                                      </div>
                                    ) : (
                                      serverTools.map((tool) => {
                                        const isToolSelected = selectedTools.includes(tool.name);
                                        return (
                                          <label key={tool.name} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', padding: '0.25rem 0' }}>
                                            <input 
                                              type="checkbox"
                                              checked={isToolSelected}
                                              disabled={!isEnabled}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setSelectedTools([...selectedTools, tool.name]);
                                                } else {
                                                  setSelectedTools(selectedTools.filter(t => t !== tool.name));
                                                }
                                              }}
                                              style={{ marginTop: '0.2rem' }}
                                            />
                                            <div>
                                              <span style={{ fontSize: '0.8rem', fontWeight: '600', color: isEnabled ? 'white' : 'var(--text-secondary)' }}>{tool.name}</span>
                                              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{tool.description}</span>
                                            </div>
                                          </label>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>

                    <details style={{ background: 'var(--inset-bg)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)', outline: 'none' }}>
                        Developer Config (Raw JSON Configuration)
                      </summary>
                      <div style={{ marginTop: '0.75rem' }} className="form-group">
                        <textarea
                          className="form-input"
                          value={mcpConfigText}
                          onChange={(e) => setMcpConfigText(e.target.value)}
                          rows={6}
                          style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                        />
                      </div>
                    </details>

                    <div style={{ marginTop: '1rem' }}>
                      <button 
                        className="btn btn-primary" 
                        onClick={handleSaveSettings}
                        disabled={isSavingSpecs}
                        style={{ width: '100%' }}
                      >
                        {isSavingSpecs ? 'Saving...' : 'Save Workspace Settings'}
                      </button>
                    </div>

                    <div style={{
                      marginTop: '2rem',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--danger-color)',
                      background: 'var(--danger-soft)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem'
                    }}>
                      <h4 style={{ margin: 0, color: 'var(--danger-color)', fontSize: '0.95rem' }}>Danger zone</h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Permanently delete this project and all of its chats, MCP credentials, and activity logs.
                        Changes already made in the client&apos;s Zoho account are not rolled back.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteConfirmName('');
                          setShowDeleteProjectModal(true);
                        }}
                        style={{
                          alignSelf: 'flex-start',
                          color: 'var(--text-on-accent)',
                          background: 'var(--danger-color)',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '0.45rem 0.85rem',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Delete permanently
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
              {/* CHAT SESSIONS SELECTOR */}
              <div style={{ 
                background: 'var(--bg-secondary)', 
                padding: '1rem', 
                borderRadius: '10px', 
                border: '1px solid var(--border-color)', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '0.75rem',
                minWidth: 0,
                maxWidth: '100%',
                overflow: 'visible',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                  <h3 style={{ fontSize: '1rem', margin: 0, fontWeight: '600', color: 'var(--text-primary)', flexShrink: 0 }}>Chat Sessions</h3>
                  <button 
                    type="button"
                    className="btn btn-secondary" 
                    onClick={handleCreateNewChat}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem', height: 'auto', flexShrink: 0 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14"/></svg>
                    New Chat
                  </button>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, width: '100%' }}>
                  {isEditingChatTitle ? (
                    <form onSubmit={handleRenameChat} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, minWidth: 0 }}>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="New Chat Title"
                        value={editChatTitleVal} 
                        onChange={e => setEditChatTitleVal(e.target.value)} 
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem', height: 'auto', flex: 1, minWidth: 0, margin: 0 }}
                        autoFocus
                      />
                      <button type="submit" className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: 'auto', flexShrink: 0 }}>Save</button>
                      <button type="button" className="btn btn-secondary" onClick={() => setIsEditingChatTitle(false)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: 'auto', flexShrink: 0 }}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <select 
                        value={activeChatId || ''} 
                        onChange={e => {
                          setActiveChatId(e.target.value);
                          setIsEditingChatTitle(false);
                        }}
                        style={{ 
                          background: 'var(--bg-primary)', 
                          color: 'var(--text-primary)', 
                          border: '1px solid var(--border-color)', 
                          padding: '0.4rem 0.6rem', 
                          borderRadius: '8px',
                          fontSize: '0.85rem',
                          outline: 'none',
                          cursor: 'pointer',
                          flex: '1 1 auto',
                          minWidth: '80px',
                          width: 0,
                        }}
                        title={chatSessions.find(c => c.id === activeChatId)?.title || ''}
                      >
                        {chatSessions.map(c => (
                          <option key={c.id} value={c.id}>{c.title}</option>
                        ))}
                      </select>
                      <button 
                        type="button" 
                        title="Rename Chat Session"
                        onClick={() => {
                          const activeChat = chatSessions.find(c => c.id === activeChatId);
                          if (activeChat) {
                            setEditChatTitleVal(activeChat.title);
                            setIsEditingChatTitle(true);
                          }
                        }}
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.45rem', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                      </button>
                      <button 
                        type="button" 
                        title="Delete Chat Session"
                        onClick={handleDeleteChat}
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--danger-color)', cursor: 'pointer', padding: '0.45rem', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
 
              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: 0 }} />
 
              <h2 style={{ fontSize: '1.1rem', margin: 0, fontWeight: '600', color: 'var(--text-primary)' }}>History of Changes</h2>
              
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                  No history logs available yet.
                </div>
              ) : (
                logs.map((log, i) => {
                  const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;
                  const userStr = log.metadata?.user || (log.description.includes('by') ? log.description.split('by').slice(-1)[0].trim() : 'Consultant Agent');
                  
                  return (
                    <details 
                      key={log.id || i} 
                      style={{ 
                        padding: '0.85rem 1rem', 
                        borderRadius: '8px', 
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderLeft: `4px solid ${log.type === 'mcp_execution' ? 'var(--success-color)' : log.type === 'mcp_failure' ? 'var(--danger-color)' : 'var(--accent-color)'}`,
                        minWidth: 0,
                        maxWidth: '100%',
                      }}
                    >
                      <summary style={{ cursor: 'pointer', outline: 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', minWidth: 0 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1, minWidth: '80px', overflow: 'hidden' }}>
                            <span style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {log.type === 'mcp_execution' ? '✓ MCP Action Executed' : log.type === 'mcp_failure' ? '✗ MCP Action Failed' : '⚙ Settings Updated'}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {log.description.replace(`by ${userStr}`, '').trim()}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem', flexShrink: 0 }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--accent-color)' }}>
                              @{userStr}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </summary>
                      
                      <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                          <span>Reference ID: {log.id || 'N/A'}</span>
                          <span>{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                        
                        {hasMetadata && (
                          <pre style={{ 
                            background: 'var(--bg-primary)', 
                            padding: '0.75rem', 
                            borderRadius: '6px', 
                            overflowX: 'auto', 
                            margin: 0,
                            fontSize: '0.75rem',
                            fontFamily: 'monospace',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-secondary)'
                          }}>
                            <code>{JSON.stringify(log.metadata, null, 2)}</code>
                          </pre>
                        )}
                      </div>
                    </details>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
