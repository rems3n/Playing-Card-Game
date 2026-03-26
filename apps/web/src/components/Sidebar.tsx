'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

interface DbProfile {
  displayName: string;
  avatarUrl: string | null;
  username: string | null;
}

const NAV_ITEMS = [
  { href: '/', label: 'Play', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )},
  { href: '/rules', label: 'Games & Rules', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )},
  { href: '/leaderboard', label: 'Leaderboard', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )},
  { href: '/settings', label: 'Settings', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )},
];

export function Sidebar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [profile, setProfile] = useState<DbProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch DB profile
  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.email) return;
    fetch(`${SERVER_URL}/api/users/me?email=${encodeURIComponent(session.user.email)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.profile) {
          setProfile({ displayName: data.profile.displayName, avatarUrl: data.profile.avatarUrl, username: data.profile.username });
        }
      })
      .catch(() => {});
  }, [session, status]);

  useEffect(() => {
    function handleProfileUpdate() {
      if (session?.user?.email) {
        fetch(`${SERVER_URL}/api/users/me?email=${encodeURIComponent(session.user.email)}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.success && data.profile) {
              setProfile({ displayName: data.profile.displayName, avatarUrl: data.profile.avatarUrl, username: data.profile.username });
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
  const resolveAvatar = (url: string) => url.startsWith('/') ? `${SERVER_URL}${url}` : url;

  return (
    <div className="w-52 h-full bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col shrink-0">
      {/* Logo */}
      <a href="/" className="flex items-center gap-2.5 px-4 h-14 border-b border-[var(--border-subtle)] shrink-0">
        <span className="text-xl">🃏</span>
        <span className="text-[15px] font-bold text-[var(--accent-gold)] tracking-tight">CardArena</span>
      </a>

      {/* Nav items */}
      <nav className="flex flex-col gap-0.5 p-2 flex-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors
                ${active
                  ? 'bg-[var(--accent-gold)]/12 text-[var(--accent-gold)]'
                  : 'text-[var(--text-secondary)] hover:text-white hover:bg-white/[0.05]'
                }
              `}
            >
              {item.icon}
              {item.label}
            </a>
          );
        })}
      </nav>

      {/* User section at bottom */}
      <div className="border-t border-[var(--border-subtle)] p-2" ref={menuRef}>
        {status === 'loading' && (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-white/5 animate-pulse" />
            <div className="w-20 h-3 rounded bg-white/5 animate-pulse" />
          </div>
        )}
        {status === 'unauthenticated' && (
          <button
            onClick={() => signIn()}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] font-medium text-[var(--accent-green)] hover:bg-white/[0.05] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            Sign In
          </button>
        )}
        {status === 'authenticated' && session?.user && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md hover:bg-white/[0.05] transition-colors"
            >
              {avatarUrl ? (
                <img src={resolveAvatar(avatarUrl)} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[var(--accent-gold)] flex items-center justify-center text-[11px] font-bold text-[#1a1a1a] shrink-0">
                  {displayName[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <div className="min-w-0 text-left">
                <div className="text-[13px] font-semibold truncate">{displayName}</div>
                {profile?.username && (
                  <div className="text-[11px] text-[var(--text-muted)] truncate">@{profile.username}</div>
                )}
              </div>
            </button>

            {menuOpen && (
              <div className="absolute left-2 bottom-full mb-1 w-44 bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-lg shadow-xl py-1 z-50">
                <a
                  href="/profile"
                  className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-white/[0.06] transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Profile
                </a>
                <div className="border-t border-[var(--border-subtle)] my-1" />
                <button
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-[var(--accent-red)] hover:bg-white/[0.06] transition-colors"
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
    </div>
  );
}
