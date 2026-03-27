'use client';

import { useSettingsStore, TABLE_COLORS, CARD_BACK_DESIGNS } from '@card-game/shared-store';
import { CardBack } from '@/components/game/PlayingCard';

export default function SettingsPage() {
  const { tableColor, setTableColor, cardBack, setCardBack } = useSettingsStore();

  return (
    <div className="max-w-2xl mx-auto p-6 h-full overflow-y-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Table Color */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-5 mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">
          Table Color
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {TABLE_COLORS.map((color) => (
            <button
              key={color.name}
              onClick={() => setTableColor(color)}
              className={`
                rounded-xl overflow-hidden border-2 transition-all
                ${tableColor.name === color.name
                  ? 'border-[var(--accent-gold)] shadow-lg shadow-[var(--accent-gold)]/20'
                  : 'border-transparent hover:border-white/20'
                }
              `}
            >
              <div className="h-16 w-full" style={{ background: color.gradient }} />
              <div className="bg-[var(--bg-tertiary)] px-3 py-1.5 text-center">
                <span className="text-xs font-medium">{color.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Card Back Design */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-5 mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">
          Card Back Design
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {CARD_BACK_DESIGNS.map((design) => (
            <button
              key={design.name}
              onClick={() => setCardBack(design)}
              className={`
                flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all
                ${cardBack.name === design.name
                  ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/5'
                  : 'border-transparent hover:border-white/20'
                }
              `}
            >
              <CardBack scale={1.1} design={design} />
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">{design.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-5">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">
          Preview
        </h2>
        <div
          className="h-40 rounded-xl border flex items-center justify-center gap-6"
          style={{
            background: tableColor.gradient,
            borderColor: tableColor.border,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 12px rgba(0,0,0,0.5)',
          }}
        >
          {/* Sample fanned cards */}
          <div className="flex items-end" style={{ gap: -8 }}>
            {[-12, -6, 0, 6, 12].map((rot, i) => (
              <div key={i} style={{ marginLeft: i > 0 ? -10 : 0 }}>
                <CardBack scale={1} design={cardBack} rotation={rot} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
