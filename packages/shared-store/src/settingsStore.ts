import { create } from 'zustand';

export interface TableColor {
  name: string;
  gradient: string;
  border: string;
}

export const TABLE_COLORS: TableColor[] = [
  { name: 'Navy', gradient: 'radial-gradient(ellipse at 50% 45%, #264a78, #1e3d66 50%, #162d4a)', border: '#2a4570' },
  { name: 'Emerald', gradient: 'radial-gradient(ellipse at 50% 45%, #2a6e4a, #225a3d 50%, #1a4830)', border: '#2a5e42' },
  { name: 'Burgundy', gradient: 'radial-gradient(ellipse at 50% 45%, #6e2a3a, #5a2230 50%, #481a28)', border: '#702a3a' },
  { name: 'Charcoal', gradient: 'radial-gradient(ellipse at 50% 45%, #484848, #3a3a3a 50%, #2c2c2c)', border: '#505050' },
  { name: 'Purple', gradient: 'radial-gradient(ellipse at 50% 45%, #3e2a6e, #32225a 50%, #281a48)', border: '#4a2a70' },
  { name: 'Teal', gradient: 'radial-gradient(ellipse at 50% 45%, #1e5a6e, #184a5a 50%, #123a48)', border: '#2a5a6e' },
];

interface SettingsStore {
  tableColor: TableColor;
  setTableColor: (color: TableColor) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  tableColor: TABLE_COLORS[0], // Navy default
  setTableColor: (color) => set({ tableColor: color }),
}));
