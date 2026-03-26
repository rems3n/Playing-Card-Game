'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

interface Friend {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
}

interface FriendRequest {
  friendshipId: string;
  from: Friend;
  createdAt: string;
}

export function FriendsList() {
  const { data: session } = useSession();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Friend[]>([]);
  const [addUsername, setAddUsername] = useState('');
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<'friends' | 'requests' | 'add'>('friends');

  const email = session?.user?.email;

  useEffect(() => {
    if (!email) return;
    loadFriends();
    loadRequests();
  }, [email]);

  async function loadFriends() {
    try {
      const res = await fetch(`${SERVER_URL}/api/friends?email=${encodeURIComponent(email!)}`);
      const data = await res.json();
      if (data.success) setFriends(data.friends);
    } catch {}
  }

  async function loadRequests() {
    try {
      const res = await fetch(`${SERVER_URL}/api/friends/requests?email=${encodeURIComponent(email!)}`);
      const data = await res.json();
      if (data.success) setRequests(data.requests);
    } catch {}
  }

  async function sendFriendRequest() {
    if (!addUsername.trim() || !email) return;
    setAddStatus(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/friends/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, targetUsername: addUsername.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setAddStatus('Request sent!');
        setAddUsername('');
      } else {
        setAddStatus(data.error || 'Failed to send');
      }
    } catch {
      setAddStatus('Failed to send');
    }
  }

  async function respondToRequest(friendshipId: string, accept: boolean) {
    if (!email) return;
    try {
      await fetch(`${SERVER_URL}/api/friends/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, friendshipId, accept }),
      });
      loadRequests();
      if (accept) loadFriends();
    } catch {}
  }

  if (!session) return null;

  return (
    <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)]">
      {/* Tabs */}
      <div className="flex border-b border-[var(--border-subtle)]">
        {(['friends', 'requests', 'add'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2.5 text-xs font-medium capitalize transition-colors ${
              tab === t
                ? 'text-white border-b-2 border-[var(--accent-gold)]'
                : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {t === 'requests' && requests.length > 0 ? `Requests (${requests.length})` : t === 'add' ? 'Add Friend' : t}
          </button>
        ))}
      </div>

      <div className="p-3">
        {/* Friends list */}
        {tab === 'friends' && (
          <div className="space-y-2">
            {friends.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-4">
                No friends yet. Add someone!
              </p>
            ) : (
              friends.map((f) => (
                <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04]">
                  {f.avatarUrl ? (
                    <img src={f.avatarUrl.startsWith('/') ? `${SERVER_URL}${f.avatarUrl}` : f.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[var(--accent-blue)]/60 flex items-center justify-center text-xs font-bold">
                      {f.displayName[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{f.displayName}</div>
                    {f.username && (
                      <div className="text-xs text-[var(--text-secondary)]">@{f.username}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Pending requests */}
        {tab === 'requests' && (
          <div className="space-y-2">
            {requests.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-4">
                No pending requests
              </p>
            ) : (
              requests.map((r) => (
                <div key={r.friendshipId} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-[var(--accent-blue)]/60 flex items-center justify-center text-xs font-bold shrink-0">
                      {r.from.displayName[0].toUpperCase()}
                    </div>
                    <span className="text-sm truncate">{r.from.displayName}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => respondToRequest(r.friendshipId, true)}
                      className="px-2 py-1 text-xs bg-[var(--accent-green)] text-white rounded hover:brightness-110"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => respondToRequest(r.friendshipId, false)}
                      className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-white"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Add friend */}
        {tab === 'add' && (
          <div>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              Enter a username to send a friend request
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] text-sm">@</span>
                <input
                  type="text"
                  value={addUsername}
                  onChange={(e) => setAddUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="username"
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-blue)]"
                  onKeyDown={(e) => e.key === 'Enter' && sendFriendRequest()}
                />
              </div>
              <button
                onClick={sendFriendRequest}
                disabled={!addUsername.trim()}
                className="px-3 py-2 text-sm bg-[var(--accent-green)] text-white rounded-lg hover:brightness-110 disabled:opacity-40 transition-all"
              >
                Send
              </button>
            </div>
            {addStatus && (
              <p className={`text-xs mt-2 ${addStatus.includes('sent') ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                {addStatus}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
