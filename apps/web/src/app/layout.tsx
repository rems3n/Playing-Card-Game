import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "CardArena · The family table",
  description:
    "Play Seven-Six online — a trick-taking bidding card game for 2-7 players. Challenge AI or play with friends!",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="app-body">
        <AuthProvider>
          <div className="app-shell">
            <a className="skip-link" href="#main-content">
              Skip to content
            </a>
            <Sidebar />
            <main id="main-content" className="app-main">
              {children}
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
