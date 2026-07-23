'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AuthButton from './AuthButton';

export default function TopHeader() {
  const pathname = usePathname();
  const isDashboard = pathname === '/';
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Initialize theme from localStorage or document attribute
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  return (
    <header className="top-header">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
          <Link
            href="/"
            title="Innovate Now"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              textDecoration: 'none',
              color: 'inherit',
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--accent-gradient)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                fontSize: '0.8rem',
                flexShrink: 0,
                color: 'var(--text-on-accent)',
              }}
            >
              IN
            </div>
            <span className="text-gradient" style={{ fontSize: '1rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Innovate Now
            </span>
          </Link>

          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)', flexShrink: 0 }} />

          <Link
            href="/"
            title="Dashboard"
            className="btn btn-secondary"
            aria-current={isDashboard ? 'page' : undefined}
            style={{
              justifyContent: 'flex-start',
              padding: '0.45rem 0.85rem',
              fontSize: '0.85rem',
              height: 'auto',
              flexShrink: 0,
              ...(isDashboard
                ? {
                    color: 'var(--accent-color)',
                    borderColor: 'var(--accent-border)',
                    background: 'var(--accent-soft)',
                  }
                : {}),
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Dashboard
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark/light theme"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '0.5rem',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s, color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {theme === 'dark' ? (
              // Sun icon for switching to light mode
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              // Moon icon for switching to dark mode
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            )}
          </button>
          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }}></div>
          <AuthButton />
          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }}></div>
          <div className="status-indicator status-online"></div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Agents Online</span>
        </div>
      </div>
    </header>
  );
}
