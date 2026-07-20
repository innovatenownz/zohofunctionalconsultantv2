import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import Providers from "./providers";
import TopHeader from "./components/TopHeader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zoho Suite & Integration Consultant Agent",
  description: "AI-powered business analyst for Zoho product implementations and integrations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <Providers>
        <div className="app-layout">
          <aside className="sidebar">
            <div style={{ padding: '2rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h1 className="text-gradient" style={{ fontSize: '1.2rem', margin: 0 }}>Innovate Now</h1>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Zoho Consultant Agent</div>
            </div>
            
            <nav style={{ padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <Link href="/" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                Dashboard
              </Link>
              <Link href="/settings" className="btn btn-secondary" style={{ justifyContent: 'flex-start', border: 'none', background: 'transparent' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Settings
              </Link>
            </nav>
            
            <div style={{ marginTop: 'auto', padding: '1.5rem 1rem' }}>
              <div className="glass-panel" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                  IN
                </div>
                <div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>Workspace</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Innovate Now</div>
                </div>
              </div>
            </div>
          </aside>
          
          <main className="main-content">
            <TopHeader />
            
            <div style={{ flex: 1, padding: '2rem' }}>
              {children}
            </div>
          </main>
        </div>
        </Providers>
      </body>
    </html>
  );
}
