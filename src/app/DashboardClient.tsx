'use client';

import { useState } from 'react';
import { Project } from '@/lib/project-service';

export default function DashboardClient({ initialProjects }: { initialProjects: Project[] }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [isModalOpen, setIsModalOpen] = useState(false);
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
        } catch (err) {
          alert("Invalid JSON in MCP Configuration");
          setIsSubmitting(false);
          return;
        }
      }

      const tagsArray = newProject.tagsString
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      const res = await fetch('/api/projects', {
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
      if (res.ok) {
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
      } else {
        const errData = await res.json();
        alert(errData.error || 'Failed to create project');
      }
    } catch (error) {
      console.error(error);
      alert('An error occurred while creating the project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleArchive = async (projectId: string, currentArchived: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !currentArchived })
      });
      if (res.ok) {
        setProjects(prev =>
          prev.map(p => (p.id === projectId ? { ...p, archived: !currentArchived } : p))
        );
      } else {
        alert('Failed to update project archive status');
      }
    } catch (err) {
      console.error(err);
      alert('Error updating archive status');
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
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
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
            <a href={`/project/${project.id}`} key={project.id} className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
              <div className="project-card-header" style={{ marginBottom: '0.75rem' }}>
                <h3 className="project-card-title" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>{project.name}</h3>
                <div style={{ 
                  padding: '0.2rem 0.6rem', 
                  borderRadius: '12px', 
                  fontSize: '0.75rem', 
                  fontWeight: '500',
                  backgroundColor: project.status === 'Active' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
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

                {/* Archive/Unarchive Action */}
                <button
                  type="button"
                  onClick={(e) => handleToggleArchive(project.id, !!project.archived, e)}
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
              </div>
            </a>
          ))
        )}
      </div>

      {/* New Project Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            padding: '2rem',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '500px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)'
          }}>
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 600 }}>Create New Project</h2>
            <form onSubmit={handleCreateProject}>
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
                  rows={4}
                  value={newProject.mcpConfigText}
                  onChange={(e) => setNewProject({...newProject, mcpConfigText: e.target.value})}
                  style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem' }}>
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
    </div>
  );
}
