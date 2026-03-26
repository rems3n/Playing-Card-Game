'use client';

import { useSettingsStore, TABLE_COLORS } from '@card-game/shared-store';

export default function SettingsPage() {
  const { tableColor, setTableColor } = useSettingsStore();

  return (
    <div className="max-w-2xl mx-auto p-6 h-full">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-5">
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
              <div
                className="h-20 w-full"
                style={{ background: color.gradient }}
              />
              <div className="bg-[var(--bg-tertiary)] px-3 py-2 text-center">
                <span className="text-xs font-medium">{color.name}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Preview */}
        <div className="mt-6">
          <div className="text-xs text-[var(--text-muted)] mb-2">Preview</div>
          <div
            className="h-32 rounded-xl border"
            style={{
              background: tableColor.gradient,
              borderColor: tableColor.border,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 12px rgba(0,0,0,0.5)',
            }}
          >
            <div className="flex items-center justify-center h-full text-white/30 text-sm">
              Your game table
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
