'use client';

import { useState, useRef, useEffect } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useGameStore } from '@card-game/shared-store';

interface ChatMessage {
  seatIndex: number;
  displayName: string;
  text: string;
  timestamp: number;
}

export function ChatPanel() {
  const socket = useSocket();
  const { gameId } = useGameStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (msg: ChatMessage) => {
      setMessages((prev) => [...prev.slice(-50), msg]);
    };
    socket.on('chat:message', handler);
    return () => { socket.off('chat:message', handler); };
  }, [socket]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || !gameId) return;
    socket.emit('chat:message', { gameId, text: input.trim() });
    setInput('');
  };

  return (
    <div className="rounded-lg border border-[var(--border-medium)] flex flex-col overflow-hidden flex-1 min-h-0" style={{ background: 'var(--bg-chat)' }}>
      <div className="px-3 py-2 border-b border-[#d8d4cd] shrink-0">
        <span className="text-[11px] font-semibold text-[#6b6560] uppercase tracking-wider">Chat</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {messages.length === 0 && (
          <p className="text-[11px] text-[#a09a94] text-center py-6">No messages yet</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="text-[12px] leading-snug break-words">
            <span className="font-semibold text-[#2a5fa0]">{msg.displayName}</span>
            <span className="text-[#a09a94] mx-1">:</span>
            <span className="text-[#3c3835]">{msg.text}</span>
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-[#d8d4cd] shrink-0">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type a message..."
            maxLength={200}
            className="flex-1 min-w-0 bg-white border border-[#d0ccc6] rounded px-2 py-1 text-[12px] text-[#2c2926] placeholder:text-[#b0aaa4] focus:outline-none focus:border-[#5b9bd5]"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className="px-2.5 py-1 text-[11px] font-semibold bg-[#5b9bd5] text-white rounded hover:brightness-110 disabled:opacity-30 transition-all shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
