import { create } from 'zustand';
import { AIDifficulty, GameType } from '@card-game/shared-types';

interface LobbyStore {
  selectedGame: GameType;
  difficulty: AIDifficulty;
  isCreating: boolean;

  setSelectedGame: (game: GameType) => void;
  setDifficulty: (difficulty: AIDifficulty) => void;
  setIsCreating: (creating: boolean) => void;
}

export const useLobbyStore = create<LobbyStore>((set) => ({
  selectedGame: GameType.Hearts,
  difficulty: AIDifficulty.Beginner,
  isCreating: false,

  setSelectedGame: (game) => set({ selectedGame: game }),
  setDifficulty: (difficulty) => set({ difficulty }),
  setIsCreating: (creating) => set({ isCreating: creating }),
}));
