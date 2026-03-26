'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

interface DbProfile {
  displayName: string;
  avatarUrl: string | null;
  username: string | null;
}

export function Navbar() {
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<DbProfile | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch profile from our DB
  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.email) return;

    async function loadProfile() {
      try {
        const res = await fetch(
          `${SERVER_URL}/api/users/me?email=${encodeURIComponent(session!.user!.email!)}`,
        );
        const data = await res.json();
        if (data.success && data.profile) {
          setProfile({
            displayName: data.profile.displayName,
            avatarUrl: data.profile.avatarUrl,
            username: data.profile.username,
          });
        }
      } catch {}
    }

    loadProfile();
  }, [session, status]);

  // Listen for profile updates from the profile page
  useEffect(() => {
    function handleProfileUpdate() {
      if (session?.user?.email) {
        fetch(`${SERVER_URL}/api/users/me?email=${encodeURIComponent(session.user.email)}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.success && data.profile) {
              setProfile({
                displayName: data.profile.displayName,
                avatarUrl: data.profile.avatarUrl,
                username: data.profile.username,
              });
            }
          })
          .catch(() => {});
      }
    }
    window.addEventListener('profile-updated', handleProfileUpdate);
    return () => window.removeEventListener('profile-updated', handleProfileUpdate);
  }, [session]);

  const displayName = profile?.displayName ?? session?.user?.name ?? 'Player';
  const avatarUrl = profile?.avatarUrl ?? session?.user?.image ?? null;

  const resolveAvatar = (url: string) =>
    url.startsWith('/') ? `${SERVER_URL}${url}` : url;

  return (
    <nav className="flex items-center justify-between px-6 h-12 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-6">
        <a href="/" className="flex items-center gap-2">
          <span className="text-lg">🃏</span>
          <span className="text-base font-bold text-[var(--accent-gold)] tracking-tight">
            CardArena
          </span>
        </a>
        <div className="flex items-center gap-1 text-sm">
          <a href="/" className="px-3 py-1.5 rounded text-white/90 hover:bg-white/[0.06] transition-colors">
            Play
          </a>
          <a href="/leaderboard" className="px-3 py-1.5 rounded text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-white transition-colors">
            Leaderboard
          </a>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {status === 'loading' && (
          <div className="w-8 h-8 rounded-full bg-white/5 animate-pulse" />
        )}
        {status === 'unauthenticated' && (
          <button
            onClick={() => signIn()}
            className="px-4 py-1.5 text-sm font-medium bg-[var(--accent-green)] text-white rounded-lg hover:brightness-110 transition-all"
          >
            Sign In
          </button>
        )}
        {status === 'authenticated' && session?.user && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              {avatarUrl ? (
                <img
                  src={resolveAvatar(avatarUrl)}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[var(--accent-gold)]/80 flex items-center justify-center text-xs font-bold text-black">
                  {displayName[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <span className="text-sm font-medium max-w-[120px] truncate">
                {displayName}
              </span>
              <svg
                className={`w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1 z-50">
                <a
                  href="/profile"
                  className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-white/[0.06] transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  <svg className="w-4 h-4 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Profile
                </a>
                <div className="border-t border-[var(--border-subtle)] my-1" />
                <button
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-[var(--accent-red)] hover:bg-white/[0.06] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
