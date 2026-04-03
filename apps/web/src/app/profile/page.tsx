'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, useRef } from 'react';
import { RatingChart } from '@/components/RatingChart';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

/** Resize an image file to a square and return as a base64 data URL. */
function resizeImageToDataUrl(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = maxSize;
      canvas.height = maxSize;
      const ctx = canvas.getContext('2d')!;

      // Crop to square from center
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

interface DbProfile {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  ratings: Array<{
    gameType: string;
    rating: number;
    ratingDeviation: number;
    gamesPlayed: number;
  }>;
  gameStats: Record<string, { played: number; wins: number }>;
}

export default function ProfilePage() {
  const { data: session, status } = useSession();

  const [profile, setProfile] = useState<DbProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [ratingHistories, setRatingHistories] = useState<Record<string, Array<{ date: string; rating: number }>>>({});

  // Editable fields
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // Original values for cancel
  const [origDisplayName, setOrigDisplayName] = useState('');
  const [origUsername, setOrigUsername] = useState('');
  const [origAvatarUrl, setOrigAvatarUrl] = useState('');

  // UI state
  const [editing, setEditing] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync user to our DB and load profile
  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.email) {
      setLoading(false);
      return;
    }

    const email = session.user.email;

    async function syncAndLoad() {
      try {
        // Sync user to our database
        await fetch(`${SERVER_URL}/api/users/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            displayName: session!.user!.name ?? 'Player',
            avatarUrl: session!.user!.image ?? null,
            provider: (session!.user as any).provider ?? 'google',
            providerId: (session!.user as any).providerId ?? email,
          }),
        });

        // Load full profile from our DB
        const res = await fetch(`${SERVER_URL}/api/users/me?email=${encodeURIComponent(email)}`);
        const data = await res.json();

        if (data.success && data.profile) {
          const p = data.profile;
          setProfile(p);
          setDisplayName(p.displayName);
          setOrigDisplayName(p.displayName);
          setUsername(p.username ?? '');
          setOrigUsername(p.username ?? '');
          setAvatarUrl(p.avatarUrl ?? session!.user!.image ?? '');
          setOrigAvatarUrl(p.avatarUrl ?? session!.user!.image ?? '');
        }
        // Fetch rating histories for charts
        const histories: Record<string, Array<{ date: string; rating: number }>> = {};
        for (const gameType of ['seven-six']) {
          try {
            const histRes = await fetch(
              `${SERVER_URL}/api/ratings/history?email=${encodeURIComponent(email)}&gameType=${gameType}&days=90`,
            );
            const histData = await histRes.json();
            if (histData.success) histories[gameType] = histData.history;
          } catch {}
        }
        setRatingHistories(histories);
      } catch (err) {
        console.error('Failed to load profile:', err);
      } finally {
        setLoading(false);
      }
    }

    syncAndLoad();
  }, [session, status]);

  // Debounced username uniqueness check
  useEffect(() => {
    if (!editing || !username || username === origUsername) {
      setUsernameStatus('idle');
      return;
    }

    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    if (!usernameRegex.test(username)) {
      setUsernameStatus('invalid');
      return;
    }

    setUsernameStatus('checking');
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `${SERVER_URL}/api/users/check-username/${encodeURIComponent(username)}`,
        );
        const data = await res.json();
        setUsernameStatus(data.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [username, editing, origUsername]);

  const handleEdit = () => {
    setEditing(true);
    setSaveMessage(null);
  };

  const handleCancel = () => {
    setDisplayName(origDisplayName);
    setUsername(origUsername);
    setAvatarUrl(origAvatarUrl);
    setEditing(false);
    setUsernameStatus('idle');
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (usernameStatus === 'taken' || usernameStatus === 'invalid') return;
    if (!session?.user?.email) return;

    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`${SERVER_URL}/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: session.user.email,
          displayName,
          username: username || undefined,
          avatarUrl,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const p = data.profile;
        setOrigDisplayName(p.displayName);
        setOrigUsername(p.username ?? '');
        setOrigAvatarUrl(p.avatarUrl ?? '');
        setEditing(false);
        setSaveMessage({ type: 'success', text: 'Profile updated!' });
        setTimeout(() => setSaveMessage(null), 3000);
        // Notify navbar to refresh
        window.dispatchEvent(new Event('profile-updated'));
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch {
      setSaveMessage({ type: 'error', text: 'Failed to save. Is the server running?' });
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-48px)]">
        <div className="text-[var(--text-secondary)]">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-48px)]">
        <div className="text-center">
          <p className="text-[var(--text-secondary)] mb-4">
            Sign in to view your profile and stats
          </p>
          <a
            href="/auth/login"
            className="px-6 py-2 bg-[var(--accent-green)] text-white rounded-lg font-medium hover:brightness-110 transition-all"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  const usernameHint = {
    idle: null,
    checking: { text: 'Checking...', color: 'text-[var(--text-secondary)]' },
    available: { text: 'Username is available!', color: 'text-[var(--accent-green)]' },
    taken: { text: 'Username is already taken', color: 'text-[var(--accent-red)]' },
    invalid: { text: 'Letters, numbers, underscores only (3-30 chars)', color: 'text-[var(--accent-red)]' },
  }[usernameStatus];

  const resolveAvatar = (url: string) =>
    url.startsWith('/uploads/') ? `${SERVER_URL}${url}` : url;

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* Save message */}
      {saveMessage && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            saveMessage.type === 'success'
              ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/20'
              : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)] border border-[var(--accent-red)]/20'
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      {/* Profile card */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] p-6 mb-6">
        <div className="flex items-start justify-between mb-6">
          <h1 className="text-lg font-semibold">Profile</h1>
          {!editing ? (
            <button
              onClick={handleEdit}
              className="px-4 py-1.5 text-sm font-medium border border-[var(--border-subtle)] rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              Edit Profile
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || usernameStatus === 'taken' || usernameStatus === 'invalid'}
                className="px-4 py-1.5 text-sm font-medium bg-[var(--accent-green)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-start gap-6">
          {/* Avatar */}
          <div className="shrink-0">
            <div className="relative group">
              {avatarUrl ? (
                <img
                  src={resolveAvatar(avatarUrl)}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-[var(--accent-gold)]/80 flex items-center justify-center text-3xl font-bold text-black">
                  {displayName?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              {editing && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  {uploading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            {editing && (
              <p className="mt-2 text-[10px] text-[var(--text-secondary)] text-center w-20">
                {uploading ? 'Uploading...' : 'Click to change'}
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                if (file.size > 5 * 1024 * 1024) {
                  setSaveMessage({ type: 'error', text: 'Image must be under 5MB' });
                  return;
                }

                setUploading(true);
                setSaveMessage(null);
                try {
                  // Resize image client-side and convert to base64 data URL
                  const dataUrl = await resizeImageToDataUrl(file, 200);
                  setAvatarUrl(dataUrl);
                } catch {
                  setSaveMessage({ type: 'error', text: 'Failed to process image' });
                } finally {
                  setUploading(false);
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Fields */}
          <div className="flex-1 space-y-4">
            {/* Display Name */}
            <div>
              <label className="block text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Display Name
              </label>
              {editing ? (
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={50}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-blue)] transition-colors"
                />
              ) : (
                <div className="text-base font-medium">{displayName}</div>
              )}
            </div>

            {/* Username */}
            <div>
              <label className="block text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Username
              </label>
              {editing ? (
                <div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] text-sm">@</span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      maxLength={30}
                      placeholder="choose_a_username"
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-blue)] transition-colors"
                    />
                    {usernameStatus === 'checking' && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-[var(--text-secondary)] border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    {usernameStatus === 'available' && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--accent-green)]">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--accent-red)]">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                    )}
                  </div>
                  {usernameHint && (
                    <p className={`text-xs mt-1 ${usernameHint.color}`}>
                      {usernameHint.text}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-base">
                  {username ? (
                    <span className="font-medium">@{username}</span>
                  ) : (
                    <span className="text-[var(--text-secondary)] italic">No username set</span>
                  )}
                </div>
              )}
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="block text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Email
              </label>
              <div className="text-sm text-[var(--text-secondary)]">
                {session?.user?.email}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ratings */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Ratings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(profile?.ratings ?? []).map((r) => (
            <div
              key={r.gameType}
              className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium capitalize">{r.gameType}</span>
                <span className="text-xs text-[var(--text-secondary)]">
                  {r.gamesPlayed} games
                </span>
              </div>
              <div className="text-3xl font-bold text-[var(--accent-gold)]">
                {Math.round(r.rating)}
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-1 mb-3">
                {r.ratingDeviation > 100 ? 'Provisional' : 'Established'}
              </div>
              <RatingChart data={ratingHistories[r.gameType] ?? []} height={100} />
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Stats</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] p-5">
          {Object.keys(profile?.gameStats ?? {}).length === 0 ? (
            <p className="text-[var(--text-secondary)] text-sm text-center py-4">
              No games played yet. Start a game to see your stats!
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(profile?.gameStats ?? {}).map(([gameType, stats]) => (
                <div key={gameType}>
                  <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1 capitalize">
                    {gameType}
                  </div>
                  <div className="text-lg font-bold">
                    {stats.wins}W / {stats.played - stats.wins}L
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {stats.played > 0
                      ? `${Math.round((stats.wins / stats.played) * 100)}% win rate`
                      : 'No games'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Games */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Games</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)]">
          <p className="text-[var(--text-secondary)] text-sm text-center py-8">
            No game history yet. Play your first game!
          </p>
        </div>
      </div>
    </div>
  );
}
