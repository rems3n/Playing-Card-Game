import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Sidebar } from "@/components/Sidebar";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "CardArena — Seven-Six and 45s",
  description:
    "Play Seven-Six and 45s online. Trick-taking card games for 2 to 7 players, with friends in a private room or against bots.",
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
