import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { GameType, AIDifficulty } from '@card-game/shared-types';
import { useGameStore } from '@card-game/shared-store';
import { useSocket } from '../src/hooks/useSocket';
import { colors } from '../src/constants/theme';

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7];

const DIFFICULTIES = [
  { value: AIDifficulty.Beginner, label: 'Beginner', desc: 'Random play' },
  { value: AIDifficulty.Intermediate, label: 'Intermediate', desc: 'Smart play' },
  { value: AIDifficulty.Advanced, label: 'Advanced', desc: 'Card counting' },
  { value: AIDifficulty.Expert, label: 'Expert', desc: 'Monte Carlo' },
];

export default function LobbyScreen() {
  const router = useRouter();
  const socket = useSocket();
  const { setGameId } = useGameStore();
  const [playerCount, setPlayerCount] = useState(4);
  const [difficulty, setDifficulty] = useState(AIDifficulty.Beginner);
  const [creating, setCreating] = useState(false);

  const handlePlay = () => {
    setCreating(true);

    socket.once('lobby:game_created', ({ gameId }) => {
      setGameId(gameId);
      router.push(`/game/${gameId}`);
    });

    socket.emit('lobby:create_game', {
      gameType: GameType.SevenSix,
      config: playerCount !== 4 ? { maxPlayers: playerCount } : undefined,
      aiDifficulty: difficulty,
      fillWithAI: true,
    });
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>
        <Text style={{ color: colors.accentGold }}>Seven</Text>-Six
      </Text>
      <Text style={styles.description}>
        Bid exactly how many tricks you'll win.{'\n'}
        Hands shrink then grow — every round counts!
      </Text>

      {/* Player count */}
      <Text style={styles.sectionLabel}>Players</Text>
      <View style={styles.chipRow}>
        {PLAYER_COUNTS.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.chip, playerCount === n && styles.chipSelected]}
            onPress={() => setPlayerCount(n)}
          >
            <Text style={[styles.chipText, playerCount === n && styles.chipTextSelected]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Difficulty */}
      <Text style={styles.sectionLabel}>AI Difficulty</Text>
      <View style={styles.diffList}>
        {DIFFICULTIES.map((d) => (
          <TouchableOpacity
            key={d.value}
            style={[styles.diffCard, difficulty === d.value && styles.diffCardSelected]}
            onPress={() => setDifficulty(d.value)}
          >
            <Text style={[styles.diffLabel, difficulty === d.value && styles.diffLabelSelected]}>{d.label}</Text>
            <Text style={styles.diffDesc}>{d.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Play button */}
      <TouchableOpacity
        style={[styles.playButton, creating && styles.playButtonDisabled]}
        onPress={handlePlay}
        disabled={creating}
      >
        <Text style={styles.playButtonText}>
          {creating ? 'Creating...' : 'Play vs AI'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bgPrimary },
  container: {
    padding: 24,
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.accentGold,
    marginBottom: 8,
  },
  description: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    alignSelf: 'flex-start',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  chip: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: colors.accentGreen,
    borderColor: colors.accentGreen,
  },
  chipText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: '#fff',
  },
  diffList: {
    alignSelf: 'stretch',
    gap: 8,
    marginBottom: 28,
  },
  diffCard: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSecondary,
  },
  diffCardSelected: {
    borderColor: colors.accentGreen,
    backgroundColor: 'rgba(129, 182, 76, 0.1)',
  },
  diffLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  diffLabelSelected: {
    color: colors.accentGreen,
  },
  diffDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  playButton: {
    paddingVertical: 16,
    paddingHorizontal: 56,
    borderRadius: 14,
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
