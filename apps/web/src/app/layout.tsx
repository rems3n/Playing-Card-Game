import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { Sidebar } from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'CardArena - Seven-Six Card Game',
  description: 'Play Seven-Six online — a trick-taking bidding card game for 2-7 players. Challenge AI or play with friends!',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden">
        <AuthProvider>
          <div className="flex h-full">
            <Sidebar />
            <main className="flex-1 min-w-0 h-full overflow-y-auto">
              {children}
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
