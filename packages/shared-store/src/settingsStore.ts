import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TableColor {
  name: string;
  gradient: string;
  border: string;
}

export interface CardBackDesign {
  name: string;
  bg: string;
  border: string;
  pattern: 'classic' | 'diamond' | 'stripe' | 'ornate' | 'minimal' | 'royal';
  accent: string;
}

export const TABLE_COLORS: TableColor[] = [
  { name: 'Navy', gradient: 'radial-gradient(ellipse at 50% 45%, #264a78, #1e3d66 50%, #162d4a)', border: '#2a4570' },
  { name: 'Emerald', gradient: 'radial-gradient(ellipse at 50% 45%, #2a6e4a, #225a3d 50%, #1a4830)', border: '#2a5e42' },
  { name: 'Burgundy', gradient: 'radial-gradient(ellipse at 50% 45%, #6e2a3a, #5a2230 50%, #481a28)', border: '#702a3a' },
  { name: 'Charcoal', gradient: 'radial-gradient(ellipse at 50% 45%, #484848, #3a3a3a 50%, #2c2c2c)', border: '#505050' },
  { name: 'Purple', gradient: 'radial-gradient(ellipse at 50% 45%, #3e2a6e, #32225a 50%, #281a48)', border: '#4a2a70' },
  { name: 'Teal', gradient: 'radial-gradient(ellipse at 50% 45%, #1e5a6e, #184a5a 50%, #123a48)', border: '#2a5a6e' },
];

export const CARD_BACK_DESIGNS: CardBackDesign[] = [
  { name: 'Classic Blue', bg: 'linear-gradient(135deg, #2d5fa1, #1e3f6f)', border: '#2a4a7f', pattern: 'classic', accent: '#4a7abf' },
  { name: 'Royal Red', bg: 'linear-gradient(135deg, #8b2a2a, #5c1a1a)', border: '#7a2020', pattern: 'diamond', accent: '#c44040' },
  { name: 'Forest Green', bg: 'linear-gradient(135deg, #2a6b3a, #1a4a28)', border: '#2a5a30', pattern: 'ornate', accent: '#40a050' },
  { name: 'Gold & Black', bg: 'linear-gradient(135deg, #2a2520, #1a1510)', border: '#4a4030', pattern: 'royal', accent: '#c8a040' },
  { name: 'Purple Velvet', bg: 'linear-gradient(135deg, #4a2a70, #2a1848)', border: '#5a3080', pattern: 'stripe', accent: '#8060b0' },
  { name: 'Midnight', bg: 'linear-gradient(135deg, #1a2030, #0a1020)', border: '#2a3050', pattern: 'minimal', accent: '#4060a0' },
];

interface SettingsStore {
  tableColor: TableColor;
  cardBack: CardBackDesign;
  setTableColor: (color: TableColor) => void;
  setCardBack: (design: CardBackDesign) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      tableColor: TABLE_COLORS[0],
      cardBack: CARD_BACK_DESIGNS[0],
      setTableColor: (color) => set({ tableColor: color }),
      setCardBack: (design) => set({ cardBack: design }),
    }),
    {
      name: 'cardarena-settings',
    },
  ),
);
