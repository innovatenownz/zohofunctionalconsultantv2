'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Project } from '@/lib/project-service';
import { apiFetch, handleApiError } from '@/app/lib/api-client';

export default function DashboardClient({ initialProjects }: { initialProjects: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showDeleteProjectModal, setShowDeleteProjectModal] = useState(false);
  const [projectPendingDelete, setProjectPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  useEffect(() => {
    if (!isModalOpen && !showDeleteProjectModal) return;
    const main = document.querySelector('.main-content') as HTMLElement | null;
    if (!main) return;
    const previousOverflow = main.style.overflowY;
    const scrollTop = main.scrollTop;
    main.style.overflowY = 'hidden';
    // Setting overflow:hidden can reset scrollTop; keep the list where it was.
    main.scrollTop = scrollTop;
    return () => {
      main.style.overflowY = previousOverflow;
      main.scrollTop = scrollTop;
    };
  }, [isModalOpen, showDeleteProjectModal]);

  const notify = (message: string, type: 'success' | 'error' = 'error') => {
    setToast({ type, message });
  };
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    driveFolderId: '',
    mcpConfigText: '{\n  "mcpServers": {\n  }\n}',
    tagsString: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search & Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Configuration Needed' | 'Archived'>('All');
  const [tagFilter, setTagFilter] = useState('');

  // Extract all unique tags for the tag filter dropdown
  const allTags = Array.from(
    new Set(projects.flatMap(p => p.tags || []))
  );

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      let parsedMcpConfig = null;
      if (newProject.mcpConfigText.trim()) {
        try {
          parsedMcpConfig = JSON.parse(newProject.mcpConfigText);
        } catch {
          notify('Invalid JSON in MCP Configuration');
          setIsSubmitting(false);
          return;
        }
      }

      const tagsArray = newProject.tagsString
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProject.name,
          description: newProject.description,
          driveFolderId: newProject.driveFolderId,
          mcpConfig: parsedMcpConfig,
          tags: tagsArray
        }),
      });
      const data = await res.json();
      setProjects([data.project, ...projects]);
      setIsModalOpen(false);
      setNewProject({
        name: '',
        description: '',
        driveFolderId: '',
        mcpConfigText: '{\n  "mcpServers": {\n  }\n}',
        tagsString: ''
      });
      window.location.href = `/project/${data.project.id}`;
    } catch (error) {
      handleApiError(error, (message) => notify(message), () => signIn('google'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleArchive = async (
    projectId: string,
    projectName: string,
    currentArchived: boolean,
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const nextArchived = !currentArchived;
    try {
      await apiFetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: nextArchived })
      });
      setProjects(prev =>
        prev.map(p => (p.id === projectId ? { ...p, archived: nextArchived } : p))
      );
      notify(
        nextArchived ? `Archived "${projectName}".` : `Restored "${projectName}".`,
        'success'
      );
    } catch (err) {
      handleApiError(err, (message) => notify(message), () => signIn('google'));
    }
  };

  const openDeleteProjectModal = (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectPendingDelete({ id: project.id, name: project.name });
    setDeleteConfirmName('');
    setShowDeleteProjectModal(true);
  };

  const handleDeleteProjectFromCard = async () => {
    if (!projectPendingDelete || deleteConfirmName !== projectPendingDelete.name) return;
    setIsDeletingProject(true);
    try {
      await apiFetch(`/api/projects/${projectPendingDelete.id}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((p) => p.id !== projectPendingDelete.id));
      setShowDeleteProjectModal(false);
      setProjectPendingDelete(null);
      setDeleteConfirmName('');
      notify(`Deleted "${projectPendingDelete.name}".`, 'success');
    } catch (err) {
      handleApiError(err, (message) => notify(message), () => signIn('google'));
    } finally {
      setIsDeletingProject(false);
    }
  };

  // Filter projects list based on search term, status, and tags
  const filteredProjects = projects.filter(project => {
    const matchesSearch =
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (project.description && project.description.toLowerCase().includes(searchTerm.toLowerCase()));

    let matchesStatus = true;
    if (statusFilter === 'Archived') {
      matchesStatus = !!project.archived;
    } else {
      // Hide archived projects from default views
      if (project.archived && statusFilter !== 'All') {
        matchesStatus = false;
      } else if (statusFilter !== 'All') {
        matchesStatus = project.status === statusFilter;
      } else {
        // 'All' selected: show everything active, hide archived unless statusFilter explicitly shows them
        matchesStatus = !project.archived;
      }
    }

    const matchesTag = !tagFilter || (project.tags && project.tags.includes(tagFilter));

    return matchesSearch && matchesStatus && matchesTag;
  });

  return (
    <>
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {toast && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          backgroundColor: toast.type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
          color: toast.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)',
          border: `1px solid ${toast.type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          animation: 'fade-in 0.3s ease'
        }}>
          <span style={{ fontWeight: '500' }}>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
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
      {/* Dashboard Title & New Project Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 600 }}>Client Projects</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Manage your Zoho integrations and agents</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Project
        </button>
      </div>

      {/* Google-Style Search & Filters Bar */}
      <div style={{ 
        display: 'flex', 
        gap: '1rem', 
        alignItems: 'center', 
        flexWrap: 'wrap', 
        padding: '1rem', 
        background: 'var(--bg-secondary)', 
        borderRadius: '12px', 
        border: '1px solid var(--border-color)' 
      }}>
        {/* Search Field */}
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <input 
            type="text" 
            placeholder="Search projects..." 
            className="form-input" 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '2.5rem', margin: 0 }}
          />
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Status:</span>
          <select 
            value={statusFilter} 
            onChange={e => setStatusFilter(e.target.value as any)}
            style={{ 
              background: 'var(--bg-primary)', 
              color: 'var(--text-primary)', 
              border: '1px solid var(--border-color)', 
              padding: '0.6rem 1rem', 
              borderRadius: '8px',
              fontSize: '0.9rem',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="All">Active Projects</option>
            <option value="Active">Active status</option>
            <option value="Configuration Needed">Configuration Needed</option>
            <option value="Archived">Archived Projects</option>
          </select>
        </div>

        {/* Tag Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Tag:</span>
          <select 
            value={tagFilter} 
            onChange={e => setTagFilter(e.target.value)}
            style={{ 
              background: 'var(--bg-primary)', 
              color: 'var(--text-primary)', 
              border: '1px solid var(--border-color)', 
              padding: '0.6rem 1rem', 
              borderRadius: '8px',
              fontSize: '0.9rem',
              outline: 'none',
              cursor: 'pointer',
              minWidth: '140px'
            }}
          >
            <option value="">All Tags</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="dashboard-grid" style={{ margin: 0, padding: 0 }}>
        {filteredProjects.length === 0 ? (
          <div style={{ 
            gridColumn: '1 / -1', 
            padding: '4rem 2rem', 
            textAlign: 'center', 
            background: 'var(--bg-secondary)', 
            borderRadius: '12px', 
            border: '1px dashed var(--border-color)',
            color: 'var(--text-secondary)'
          }}>
            No projects found matching the criteria.
          </div>
        ) : (
          filteredProjects.map(project => (
            <div
              key={project.id}
              className="card"
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/project/${project.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(`/project/${project.id}`);
                }
              }}
              style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', cursor: 'pointer' }}
            >
              <div className="project-card-header" style={{ marginBottom: '0.75rem' }}>
                <h3 className="project-card-title" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>{project.name}</h3>
                <div style={{ 
                  padding: '0.2rem 0.6rem', 
                  borderRadius: '12px', 
                  fontSize: '0.75rem', 
                  fontWeight: '500',
                  backgroundColor: project.status === 'Active' ? 'var(--success-soft)' : 'var(--danger-soft)',
                  color: project.status === 'Active' ? 'var(--success-color)' : 'var(--danger-color)'
                }}>
                  {project.status}
                </div>
              </div>
              
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', flex: 1 }}>
                {project.description || "Zoho Suite & Integration Implementation"}
              </p>

              {/* Display tags */}
              {project.tags && project.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                  {project.tags.map(tag => (
                    <span 
                      key={tag} 
                      style={{ 
                        fontSize: '0.7rem', 
                        padding: '0.15rem 0.5rem', 
                        background: 'var(--bg-tertiary)', 
                        border: '1px solid var(--border-color)', 
                        borderRadius: '4px',
                        color: 'var(--accent-color)',
                        fontWeight: '500'
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="project-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>Synced: {project.lastSync || "Never"}</span>
                </div>

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                {/* Archive/Unarchive Action */}
                <button
                  type="button"
                  onClick={(e) => handleToggleArchive(project.id, project.name, !!project.archived, e)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.8rem',
                    color: project.archived ? 'var(--success-color)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                    transition: 'all 0.15s ease'
                  }}
                  title={project.archived ? "Restore / Unarchive Project" : "Archive Project"}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {project.archived ? (
                      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9zm9 4V8m-3 3l3-3 3 3"/>
                    ) : (
                      <path d="M21 8v13H3V8M1 3h22v5H1V3zm10 8h2"/>
                    )}
                  </svg>
                  <span>{project.archived ? "Restore" : "Archive"}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => openDeleteProjectModal(project, e)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.8rem',
                    color: 'var(--danger-color)',
                    cursor: 'pointer',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    border: '1px solid var(--danger-color)',
                    background: 'var(--danger-soft)',
                    transition: 'all 0.15s ease'
                  }}
                  title="Delete Project Permanently"
                >
                  <span>Delete</span>
                </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>

    {/* New Project Modal — outside .animate-fade-in so position:fixed is viewport-relative */}
    {isModalOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'var(--overlay-scrim)',
          display: 'flex',
          alignItems: 'safe center',
          justifyContent: 'center',
          padding: '1rem',
          overflowY: 'auto',
          backdropFilter: 'blur(4px)',
        }}
      >
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            padding: '1.25rem 1.5rem',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '500px',
            maxHeight: 'calc(100vh - 2rem)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
            boxSizing: 'border-box',
            margin: 'auto',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}>
            <h2 id="new-project-title" style={{ margin: '0 0 1rem', fontSize: '1.35rem', fontWeight: 600, flexShrink: 0 }}>Create New Project</h2>
            <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
              <div style={{ overflowY: 'auto', minHeight: 0, flex: 1, paddingRight: '0.25rem' }}>
              <div className="form-group">
                <label className="form-label">Project Name *</label>
                <input 
                  type="text" 
                  required
                  className="form-input"
                  value={newProject.name}
                  onChange={(e) => setNewProject({...newProject, name: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={newProject.description}
                  onChange={(e) => setNewProject({...newProject, description: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Google Drive Folder ID</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={newProject.driveFolderId}
                  onChange={(e) => setNewProject({...newProject, driveFolderId: e.target.value})}
                  placeholder="e.g. 1aBcDeFgHiJkLmNoPqRsTuVwXyZ"
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                  Share this folder with the Firebase Service Account.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Tags (comma-separated)</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={newProject.tagsString}
                  onChange={(e) => setNewProject({...newProject, tagsString: e.target.value})}
                  placeholder="e.g. Zoho CRM, Drive, OAuth"
                />
              </div>
              <div className="form-group">
                <label className="form-label">MCP Configuration (JSON)</label>
                <textarea 
                  className="form-input"
                  rows={3}
                  value={newProject.mcpConfigText}
                  onChange={(e) => setNewProject({...newProject, mcpConfigText: e.target.value})}
                  style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                />
              </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
      </div>
    )}

    {/* Delete project modal — outside .animate-fade-in so position:fixed is viewport-relative (same as D12 / Settings delete) */}
    {showDeleteProjectModal && projectPendingDelete && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-delete-project-title"
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
          <h3 id="dashboard-delete-project-title" style={{ margin: 0, color: 'var(--danger-color)' }}>
            Delete project permanently?
          </h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            This permanently removes chats, MCP credentials, and activity logs for
            <strong> {projectPendingDelete.name}</strong>. Any changes already made in the
            client&apos;s real Zoho account are <strong>not</strong> rolled back. This cannot be undone.
          </p>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Type the project name <strong>{projectPendingDelete.name}</strong> to confirm
            <input
              className="form-input"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={projectPendingDelete.name}
              autoFocus
              style={{ marginTop: '0.35rem', width: '100%' }}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isDeletingProject}
              onClick={() => {
                setShowDeleteProjectModal(false);
                setProjectPendingDelete(null);
                setDeleteConfirmName('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDeletingProject || deleteConfirmName !== projectPendingDelete.name}
              onClick={handleDeleteProjectFromCard}
              style={{
                color: 'var(--text-on-accent)',
                background: deleteConfirmName === projectPendingDelete.name ? 'var(--danger-color)' : 'var(--bg-tertiary)',
                border: 'none',
                borderRadius: '6px',
                padding: '0.45rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: deleteConfirmName === projectPendingDelete.name ? 'pointer' : 'not-allowed',
                opacity: deleteConfirmName === projectPendingDelete.name ? 1 : 0.5
              }}
            >
              {isDeletingProject ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
