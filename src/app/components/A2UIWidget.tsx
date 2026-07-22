'use client';

import { useState } from 'react';
import { deriveToolResultChrome, formatToolResultBoolean } from '@/lib/mcp-tool-result-chrome';

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [x: string]: JSONValue }
  | Array<JSONValue>;

interface A2UIWidgetProps {
  jsonString: string;
  commandContext?: {
    action?: string;
    [key: string]: JSONValue;
  } | null;
}

export default function A2UIWidget({ jsonString, commandContext }: A2UIWidgetProps) {
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 5;

  let parsed: any = null;
  let isJson = false;
  try {
    // Empty / whitespace-only fences must not crash render — fall back to raw <pre>.
    const trimmed = typeof jsonString === 'string' ? jsonString.trim() : '';
    if (trimmed) {
      parsed = JSON.parse(trimmed);
      isJson = true;
    }
  } catch {
    // Malformed JSON — neutral raw fallback below
    parsed = null;
    isJson = false;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };


  if (!isJson || parsed === null) {
    return (
      <pre style={{
        background: 'var(--bg-primary)',
        padding: '1rem',
        borderRadius: '8px',
        overflowX: 'auto',
        border: '1px solid var(--border-color)',
        margin: 0,
        fontSize: '0.85rem'
      }}>
        <code>{jsonString}</code>
      </pre>
    );
  }

  const chrome = deriveToolResultChrome(parsed, commandContext);

  // 1. Render Tools List View
  const renderToolsList = (tools: any[]) => {
    const filteredTools = tools.filter(t => 
      t && typeof t.name === 'string' && (
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (t.description && typeof t.description === 'string' && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <input 
            type="text" 
            placeholder="Search tools..." 
            className="form-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', flex: 1, margin: 0 }}
          />
          <div style={{ padding: '0.5rem 0.8rem', background: 'var(--bg-tertiary)', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {filteredTools.length} Tools
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', maxHeight: '350px', overflowY: 'auto' }}>
          {filteredTools.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              No matching tools found.
            </div>
          ) : (
            filteredTools.map((tool, idx) => (
              <div key={idx} style={{ padding: '0.75rem 1rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600', color: 'var(--accent-color)', fontFamily: 'monospace', fontSize: '0.95rem' }}>{tool.name}</span>
                  {tool.serverName && (
                    <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', color: 'var(--text-secondary)' }}>
                      {tool.serverName}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {tool.description || 'No description provided.'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // 2. Render Table View for Arrays
  const renderTable = (items: any[]) => {
    if (items.length === 0) {
      return <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>Empty Array</div>;
    }

    const allKeys: string[] = Array.from(
      new Set<string>(
        items.flatMap((item: any) =>
          typeof item === 'object' && item !== null ? Object.keys(item) : ['Value']
        )
      )
    );

    const filteredItems = items.filter((item: any) => {
      if (typeof item !== 'object' || item === null) {
        return String(item).toLowerCase().includes(searchQuery.toLowerCase());
      }
      return Object.values(item).some((val) =>
        String(val).toLowerCase().includes(searchQuery.toLowerCase())
      );
    });

    const totalPages = Math.ceil(filteredItems.length / pageSize);
    const paginatedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="Search records..."
            className="form-input"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', maxWidth: '250px', margin: 0 }}
          />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Showing {filteredItems.length} of {items.length} records
          </span>
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-primary)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left', minWidth: '400px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                {allKeys.slice(0, 5).map((key) => (
                  <th key={key} style={{ padding: '0.6rem 0.8rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
                    {key}
                  </th>
                ))}
                {allKeys.length > 5 && <th style={{ padding: '0.6rem 0.8rem', color: 'var(--text-secondary)' }}>...</th>}
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={Math.min(allKeys.length, 6)} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No matching records found.
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item: any, idx: number) => {
                  const isItemObj = typeof item === 'object' && item !== null;
                  return (
                    <tr 
                      key={idx} 
                      style={{ 
                        borderBottom: idx < paginatedItems.length - 1 ? '1px solid var(--border-color)' : 'none',
                        background: idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'
                      }}
                    >
                      {allKeys.slice(0, 5).map((key) => {
                        const val = isItemObj ? item[key] : (key === 'Value' ? item : undefined);
                        let displayVal = '';
                        if (val === undefined) {
                          displayVal = '-';
                        } else if (typeof val === 'object' && val !== null) {
                          displayVal = JSON.stringify(val);
                        } else {
                          displayVal = String(val);
                        }
                        return (
                          <td 
                            key={key} 
                            style={{ 
                              padding: '0.6rem 0.8rem', 
                              color: 'var(--text-primary)', 
                              whiteSpace: 'nowrap', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              maxWidth: '180px' 
                            }} 
                            title={displayVal}
                          >
                            {displayVal}
                          </td>
                        );
                      })}
                      {allKeys.length > 5 && <td style={{ padding: '0.6rem 0.8rem', color: 'var(--text-secondary)' }}>...</td>}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
            >
              Previous
            </button>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  };

  // Helper to convert snake_case/camelCase to readable labels
  const formatKeyLabel = (key: string): string => {
    // Specific overrides
    if (key === 'sku') return 'SKU';
    if (key === 'id') return 'Record ID';
    if (key === 'organization_id') return 'Organization ID';
    
    return key
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  };

  // Helper to format values nicely (booleans, currency, etc.)
  const formatValue = (key: string, val: any): React.ReactNode => {
    if (val === null || val === undefined) return '-';
    if (typeof val === 'boolean') {
      const { label, tone } = formatToolResultBoolean(key, val);
      const color =
        tone === 'error'
          ? 'var(--error-color, #f87171)'
          : tone === 'success'
            ? 'var(--success-color)'
            : 'var(--text-secondary)';
      const weight = tone === 'error' || tone === 'success' ? '600' : '400';
      return (
        <span style={{ color, fontWeight: weight, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
          {label}
        </span>
      );
    }
    
    const lowerKey = key.toLowerCase();
    if ((lowerKey.includes('rate') || lowerKey.includes('price') || lowerKey.includes('amount') || lowerKey.includes('cost')) && typeof val === 'number') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    }
    
    return String(val);
  };

  // 3. Render Object Key-Values View
  const renderObject = (obj: any) => {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>Empty Object</div>;
    }

    // Classify fields into Primary (user-friendly) vs Secondary (technical/system details)
    const primaryFields: Array<{ key: string; value: any }> = [];
    const technicalFields: Array<{ key: string; value: any }> = [];

    const coreKeys = ['name', 'sku', 'rate', 'price', 'purchase_rate', 'id', 'status', 'email', 'company', 'organization_id', 'item_type', 'product_type', 'unit'];

    keys.forEach(key => {
      const val = obj[key];
      const lowerKey = key.toLowerCase();
      
      const isInternalId = (lowerKey.endsWith('_id') || lowerKey.endsWith('id')) && !coreKeys.includes(lowerKey);
      const isEmptyArray = Array.isArray(val) && val.length === 0;
      const isEmptyObj = typeof val === 'object' && val !== null && !Array.isArray(val) && Object.keys(val).length === 0;
      const isNullOrEmpty = val === null || val === undefined || val === '';

      if (isInternalId || isEmptyArray || isEmptyObj || isNullOrEmpty || typeof val === 'object') {
        technicalFields.push({ key, value: val });
      } else {
        primaryFields.push({ key, value: val });
      }
    });

    // Sort primary fields to put core keys first
    primaryFields.sort((a, b) => {
      const aCoreIdx = coreKeys.indexOf(a.key.toLowerCase());
      const bCoreIdx = coreKeys.indexOf(b.key.toLowerCase());
      if (aCoreIdx !== -1 && bCoreIdx !== -1) return aCoreIdx - bCoreIdx;
      if (aCoreIdx !== -1) return -1;
      if (bCoreIdx !== -1) return 1;
      return a.key.localeCompare(b.key);
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Core summary grid */}
        {primaryFields.length > 0 ? (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
            gap: '0.75rem' 
          }}>
            {primaryFields.map(({ key, value }) => (
              <div 
                key={key} 
                style={{ 
                  padding: '0.75rem 1rem', 
                  borderRadius: '8px', 
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem'
                }}
              >
                <span style={{ 
                  fontWeight: '500', 
                  fontSize: '0.75rem', 
                  color: 'var(--text-secondary)'
                }}>
                  {formatKeyLabel(key)}
                </span>
                <span style={{ 
                  fontSize: '0.9rem', 
                  color: 'var(--text-primary)',
                  fontWeight: '600',
                  wordBreak: 'break-all'
                }}>
                  {formatValue(key, value)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>
            No summary fields available. See system details below.
          </div>
        )}

        {/* Collapsible Technical Details Drawer */}
        {technicalFields.length > 0 && (
          <details style={{ 
            border: '1px solid var(--border-color)', 
            borderRadius: '8px', 
            background: 'rgba(0,0,0,0.1)' 
          }}>
            <summary style={{ 
              padding: '0.5rem 1rem', 
              fontSize: '0.8rem', 
              color: 'var(--text-secondary)', 
              cursor: 'pointer', 
              fontWeight: '500', 
              outline: 'none' 
            }}>
              ⚙️ System Fields & Technical Metadata ({technicalFields.length})
            </summary>
            
            <div style={{ 
              padding: '0.75rem 1rem', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '0.5rem',
              borderTop: '1px solid var(--border-color)',
              maxHeight: '200px',
              overflowY: 'auto'
            }}>
              {technicalFields.map(({ key, value }) => {
                const isObj = typeof value === 'object' && value !== null;
                return (
                  <div 
                    key={key} 
                    style={{ 
                      display: 'flex', 
                      flexDirection: isObj ? 'column' : 'row',
                      justifyContent: isObj ? 'flex-start' : 'space-between',
                      padding: '0.35rem 0',
                      borderBottom: '1px dashed rgba(255,255,255,0.03)',
                      fontSize: '0.75rem',
                      gap: isObj ? '0.25rem' : '1rem'
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {key}
                    </span>
                    <span style={{ 
                      color: isObj ? 'var(--accent-color)' : 'var(--text-primary)',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      textAlign: isObj ? 'left' : 'right'
                    }}>
                      {isObj ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    );
  };

  // Determine what view renderer to use
  const renderVisualContent = () => {
    if (parsed.tools && Array.isArray(parsed.tools)) {
      return renderToolsList(parsed.tools);
    }
    if (parsed.modules && Array.isArray(parsed.modules)) {
      return renderTable(parsed.modules);
    }
    if (parsed.fields && Array.isArray(parsed.fields)) {
      return renderTable(parsed.fields);
    }
    if (Array.isArray(parsed)) {
      return renderTable(parsed);
    }
    // Check if it has a nested single data array
    const keys = Object.keys(parsed);
    if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
      return renderTable(parsed[keys[0]]);
    }

    return renderObject(parsed);
  };

  return (
    <div 
      className="glass-panel" 
      style={{ 
        margin: '1rem 0', 
        border: '1px solid var(--border-color)', 
        borderRadius: '12px', 
        overflow: 'hidden', 
        background: 'var(--bg-secondary)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)'
      }}
    >
      {/* Widget Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '0.75rem 1.25rem', 
        background: 'rgba(255,255,255,0.02)', 
        borderBottom: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', background: chrome.badgeBackground, color: chrome.badgeColor, fontSize: '0.8rem', fontWeight: 'bold' }}>
            {chrome.badgeLabel}
          </span>
          <span style={{ fontWeight: '600', fontSize: '0.95rem', color: chrome.isToolError ? chrome.badgeColor : 'var(--text-primary)' }}>
            {chrome.title}
          </span>
        </div>

        <button 
          type="button"
          onClick={handleCopy}
          style={{ 
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.3rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.75rem',
            background: 'var(--bg-primary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          {copied ? (
            <span style={{ color: 'var(--success-color)' }}>Copied!</span>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* Main Interactive Table / Cards / Properties */}
      <div style={{ padding: '1.25rem', maxHeight: '450px', overflowY: 'auto' }}>
        {renderVisualContent()}
      </div>

      {/* Collapsed Developer Info Drawer */}
      <details style={{ borderTop: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
        <summary style={{ padding: '0.6rem 1.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: '500', outline: 'none' }}>
          Developer Details (Raw JSON Response)
        </summary>
        <div style={{ padding: '1rem' }}>
          <pre style={{ 
            background: 'var(--bg-primary)', 
            padding: '0.8rem', 
            borderRadius: '6px', 
            overflowX: 'auto', 
            margin: 0,
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            border: '1px solid var(--border-color)',
            color: '#34d399'
          }}>
            <code>{jsonString}</code>
          </pre>
        </div>
      </details>
    </div>
  );
}
