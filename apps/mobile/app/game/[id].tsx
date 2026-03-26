import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { GamePhase, type Card, Suit, Rank } from '@card-game/shared-types';
import { useGameStore } from '@card-game/shared-store';
import { useSocket } from '../../src/hooks/useSocket';
import { colors } from '../../src/constants/theme';

const SUIT_SYMBOL: Record<string, string> = {
  [Suit.Hearts]: '\u2665', [Suit.Diamonds]: '\u2666',
  [Suit.Clubs]: '\u2663', [Suit.Spades]: '\u2660',
};

const RANK_DISPLAY: Record<number, string> = {
  [Rank.Two]: '2', [Rank.Three]: '3', [Rank.Four]: '4', [Rank.Five]: '5',
  [Rank.Six]: '6', [Rank.Seven]: '7', [Rank.Eight]: '8', [Rank.Nine]: '9',
  [Rank.Ten]: '10', [Rank.Jack]: 'J', [Rank.Queen]: 'Q', [Rank.King]: 'K',
  [Rank.Ace]: 'A',
};

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const socket = useSocket();
  const { gameState, setGameState, setGameId, setGameOver, setError } = useGameStore();

  useEffect(() => {
    if (!id) return;
    setGameId(id);

    socket.on('game:state', (state) => setGameState(state));
    socket.on('game:over', (result) => setGameOver(result));
    socket.on('game:error', (err) => setError(err.message));

    if (socket.connected) {
      socket.emit('game:join', { gameId: id });
    }
    socket.on('connect', () => socket.emit('game:join', { gameId: id }));

    return () => {
      socket.off('game:state');
      socket.off('game:over');
      socket.off('game:error');
      socket.off('connect');
    };
  }, [id, socket]);

  const handlePlayCard = (card: Card) => {
    if (!id || !gameState) return;
    if (gameState.phase !== GamePhase.Playing || gameState.currentPlayerSeat !== gameState.mySeat) return;
    socket.emit('game:play_card', { gameId: id, card });
  };

  if (!gameState) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Waiting for game...</Text>
      </View>
    );
  }

  const isMyTurn = gameState.phase === GamePhase.Playing && gameState.currentPlayerSeat === gameState.mySeat;

  return (
    <View style={styles.container}>
      {/* Opponents */}
      <View style={styles.opponentRow}>
        {gameState.players
          .filter((p) => p.seatIndex !== gameState.mySeat)
          .map((p) => (
            <View key={p.seatIndex} style={[
              styles.playerBadge,
              gameState.currentPlayerSeat === p.seatIndex && styles.activeBadge,
            ]}>
              <Text style={styles.playerName} numberOfLines={1}>{p.displayName}</Text>
              <Text style={styles.playerStats}>{p.tricksWon}T / {p.score}pts</Text>
            </View>
          ))}
      </View>

      {/* Trick area */}
      <View style={styles.trickArea}>
        {gameState.currentTrick.map(({ seatIndex, card }) => (
          <View key={`${card.suit}${card.rank}`} style={styles.trickCard}>
            <Text style={[styles.trickCardText, (card.suit === Suit.Hearts || card.suit === Suit.Diamonds) && styles.redText]}>
              {RANK_DISPLAY[card.rank]}{SUIT_SYMBOL[card.suit]}
            </Text>
          </View>
        ))}
      </View>

      {/* Status */}
      <Text style={[styles.status, isMyTurn && styles.statusActive]}>
        {isMyTurn ? 'Your turn' : `Waiting for ${gameState.players[gameState.currentPlayerSeat]?.displayName}`}
      </Text>

      {/* My hand */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hand}>
        {gameState.myHand.map((card) => {
          const legal = gameState.legalMoves.some((m) => m.suit === card.suit && m.rank === card.rank);
          const isRed = card.suit === Suit.Hearts || card.suit === Suit.Diamonds;
          return (
            <TouchableOpacity
              key={`${card.suit}${card.rank}`}
              style={[styles.card, !isMyTurn || !legal ? styles.cardDisabled : null]}
              onPress={() => handlePlayCard(card)}
              disabled={!isMyTurn || !legal}
            >
              <Text style={[styles.cardRank, isRed && styles.redText]}>{RANK_DISPLAY[card.rank]}</Text>
              <Text style={[styles.cardSuit, isRed && styles.redText]}>{SUIT_SYMBOL[card.suit]}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgTable, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary },
  muted: { color: colors.textMuted, fontSize: 14 },
  opponentRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
  playerBadge: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 120 },
  activeBadge: { borderWidth: 1, borderColor: colors.accentGreen },
  playerName: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  playerStats: { color: colors.textSecondary, fontSize: 10, marginTop: 2 },
  trickArea: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  trickCard: { backgroundColor: '#f7f6f5', borderRadius: 6, width: 44, height: 60, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  trickCardText: { fontSize: 14, fontWeight: 'bold', color: '#1a1a1a' },
  redText: { color: '#c33' },
  status: { textAlign: 'center', color: colors.textMuted, fontSize: 13, marginVertical: 12 },
  statusActive: { color: colors.accentGreen, fontWeight: '600' },
  hand: { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingBottom: 20 },
  card: { backgroundColor: '#f7f6f5', borderRadius: 6, width: 50, height: 72, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#c8c5c1', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, elevation: 2 },
  cardDisabled: { opacity: 0.35 },
  cardRank: { fontSize: 16, fontWeight: 'bold', color: '#1a1a1a' },
  cardSuit: { fontSize: 20, color: '#1a1a1a', marginTop: -2 },
});
