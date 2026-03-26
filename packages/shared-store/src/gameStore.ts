import { create } from 'zustand';
import type { Card, VisibleGameState } from '@card-game/shared-types';

interface LastTrick {
  winningSeat: number;
  cards: Array<{ seatIndex: number; card: Card }>;
  points: number;
}

interface GameOver {
  finalScores: number[];
  winnerSeat: number;
}

interface GameStore {
  gameId: string | null;
  gameState: VisibleGameState | null;
  selectedCards: Card[];
  lastTrick: LastTrick | null;
  gameOver: GameOver | null;
  error: string | null;

  setGameId: (id: string) => void;
  setGameState: (state: VisibleGameState) => void;
  toggleCardSelection: (card: Card) => void;
  clearSelectedCards: () => void;
  setLastTrick: (trick: LastTrick | null) => void;
  setGameOver: (result: GameOver | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  gameId: null,
  gameState: null,
  selectedCards: [],
  lastTrick: null,
  gameOver: null,
  error: null,

  setGameId: (id) => set({ gameId: id }),
  setGameState: (state) => set({ gameState: state, error: null }),
  toggleCardSelection: (card) => {
    const { selectedCards } = get();
    const exists = selectedCards.some(
      (c) => c.suit === card.suit && c.rank === card.rank,
    );
    if (exists) {
      set({
        selectedCards: selectedCards.filter(
          (c) => !(c.suit === card.suit && c.rank === card.rank),
        ),
      });
    } else {
      set({ selectedCards: [...selectedCards, card] });
    }
  },
  clearSelectedCards: () => set({ selectedCards: [] }),
  setLastTrick: (trick) => set({ lastTrick: trick }),
  setGameOver: (result) => set({ gameOver: result }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      gameId: null,
      gameState: null,
      selectedCards: [],
      lastTrick: null,
      gameOver: null,
      error: null,
    }),
}));
