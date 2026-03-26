import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { GameType, AIDifficulty } from '@card-game/shared-types';
import { useGameStore } from '@card-game/shared-store';
import { useSocket } from '../src/hooks/useSocket';
import { colors } from '../src/constants/theme';

const GAMES = [
  { type: GameType.Hearts, name: 'Hearts', icon: '♥' },
  { type: GameType.Spades, name: 'Spades', icon: '♠' },
  { type: GameType.Euchre, name: 'Euchre', icon: '🃏' },
];

export default function LobbyScreen() {
  const router = useRouter();
  const socket = useSocket();
  const { setGameId } = useGameStore();
  const [selectedGame, setSelectedGame] = useState(GameType.Hearts);
  const [creating, setCreating] = useState(false);

  const handlePlay = () => {
    setCreating(true);

    socket.once('lobby:game_created', ({ gameId }) => {
      setGameId(gameId);
      router.push(`/game/${gameId}`);
    });

    socket.emit('lobby:create_game', {
      gameType: selectedGame,
      aiDifficulty: AIDifficulty.Intermediate,
      fillWithAI: true,
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        <Text style={{ color: colors.accentGold }}>Card</Text>Arena
      </Text>
      <Text style={styles.subtitle}>Play card games against AI or friends</Text>

      <View style={styles.gameList}>
        {GAMES.map((game) => (
          <TouchableOpacity
            key={game.type}
            style={[
              styles.gameCard,
              selectedGame === game.type && styles.gameCardSelected,
            ]}
            onPress={() => setSelectedGame(game.type)}
          >
            <Text style={styles.gameIcon}>{game.icon}</Text>
            <Text style={styles.gameName}>{game.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.playButton, creating && styles.playButtonDisabled]}
        onPress={handlePlay}
        disabled={creating}
      >
        <Text style={styles.playButtonText}>
          {creating ? 'Creating...' : 'Play vs AI'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPrimary,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 32,
  },
  gameList: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  gameCard: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    minWidth: 90,
  },
  gameCardSelected: {
    borderColor: colors.accentGold,
    backgroundColor: 'rgba(232, 166, 58, 0.1)',
  },
  gameIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  gameName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  playButton: {
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    backgroundColor: colors.accentGreen,
  },
  playButtonDisabled: {
    opacity: 0.5,
  },
  playButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
});
