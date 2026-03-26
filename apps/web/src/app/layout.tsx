import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { Sidebar } from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'CardArena - Play Card Games Online',
  description: 'Play Hearts, Spades, and Euchre online against friends or AI opponents',
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
