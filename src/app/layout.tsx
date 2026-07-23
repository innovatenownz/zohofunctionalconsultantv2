import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
