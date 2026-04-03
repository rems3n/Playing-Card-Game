import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { GamePhase, GameType, type Card, Suit, Rank, AIDifficulty } from '@card-game/shared-types';
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
  const router = useRouter();
  const socket = useSocket();
  const { gameState, gameOver, setGameState, setGameId, setGameOver, setError } = useGameStore();
  const [selectedBid, setSelectedBid] = useState(0);

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

  const handleBid = (bid: number) => {
    if (!id) return;
    socket.emit('game:bid', { gameId: id, bid });
  };

  const handlePlayAgain = () => {
    if (!gameState) return;
    socket.once('lobby:game_created', ({ gameId: newId }) => {
      router.replace(`/game/${newId}`);
    });
    socket.emit('lobby:create_game', {
      gameType: GameType.SevenSix,
      config: gameState.config,
      fillWithAI: true,
    });
  };

  if (!gameState) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Connecting to game...</Text>
      </View>
    );
  }

  const isMyTurn = gameState.phase === GamePhase.Playing && gameState.currentPlayerSeat === gameState.mySeat;
  const isBidding = gameState.phase === GamePhase.Bidding;
  const isBiddingMyTurn = isBidding && gameState.currentPlayerSeat === gameState.mySeat;
  const trumpSymbol = gameState.trumpSuit ? SUIT_SYMBOL[gameState.trumpSuit] : '';
  const handSize = gameState.handSize ?? gameState.myHand.length;
  const bids = gameState.bids ?? [];
  const isDealer = gameState.dealerSeat === gameState.mySeat;
  const currentBidTotal = bids.filter((b): b is number => b !== null).reduce((s, b) => s + b, 0);
  const restrictedBid = isDealer ? handSize - currentBidTotal : -1;

  // ── Game Over ──
  if (gameOver) {
    return (
      <View style={styles.gameOverContainer}>
        <Text style={styles.gameOverTitle}>Game Over</Text>
        <Text style={styles.gameOverWinner}>
          Winner: {gameState.players[gameOver.winnerSeat]?.displayName}
        </Text>
        <View style={styles.gameOverScores}>
          {gameOver.finalScores.map((score, i) => (
            <View key={i} style={styles.gameOverScoreRow}>
              <Text style={styles.gameOverName} numberOfLines={1}>
                {gameState.players[i]?.displayName}
              </Text>
              <Text style={styles.gameOverScore}>{score}</Text>
            </View>
          ))}
        </View>
        <View style={styles.gameOverButtons}>
          <TouchableOpacity style={styles.playAgainBtn} onPress={handlePlayAgain}>
            <Text style={styles.playAgainText}>Play Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.lobbyBtn} onPress={() => router.replace('/')}>
            <Text style={styles.lobbyText}>Lobby</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header: round info + trump */}
      <View style={styles.header}>
        <Text style={styles.headerText}>
          R{(gameState.roundNumber ?? 0) + 1}/{gameState.totalRounds ?? '?'}
        </Text>
        <Text style={styles.headerText}>{handSize} card{handSize !== 1 ? 's' : ''}</Text>
        {trumpSymbol ? (
          <Text style={[styles.headerText, { color: colors.accentGold }]}>Trump {trumpSymbol}</Text>
        ) : null}
      </View>

      {/* Scoreboard with bids */}
      <View style={styles.scoreboard}>
        {gameState.players.map((p) => {
          const bid = bids[p.seatIndex];
          const hasBid = bid != null;
          const isMe = p.seatIndex === gameState.mySeat;
          const isDlr = p.seatIndex === gameState.dealerSeat;
          const isCurrent = p.seatIndex === gameState.currentPlayerSeat;
          return (
            <View key={p.seatIndex} style={[styles.scoreRow, isCurrent && styles.scoreRowActive]}>
              <Text style={styles.scoreIcon}>{isDlr ? 'D' : p.isAI ? '🤖' : '👤'}</Text>
              <Text style={[styles.scoreName, isMe && { color: colors.accentGold }]} numberOfLines={1}>
                {p.displayName}{isMe ? ' (You)' : ''}
              </Text>
              {hasBid && (
                <Text style={[styles.scoreBid, p.tricksWon === bid ? { color: colors.accentGreen } : p.tricksWon > bid ? { color: colors.accentRed } : null]}>
                  {p.tricksWon}/{bid}
                </Text>
              )}
              <Text style={[styles.scoreTotal, isMe && { color: colors.accentGold }]}>
                {gameState.scores[p.seatIndex]}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Bidding phase */}
      {isBidding && (
        <View style={styles.biddingArea}>
          <Text style={styles.biddingTitle}>
            {isBiddingMyTurn
              ? `Your bid${isDealer ? ' (dealer)' : ''}`
              : `Waiting for ${gameState.players[gameState.currentPlayerSeat]?.displayName}`}
          </Text>
          {isBiddingMyTurn && (
            <View style={styles.bidButtons}>
              {Array.from({ length: handSize + 1 }, (_, i) => i).map((b) => {
                const disabled = b === restrictedBid;
                return (
                  <TouchableOpacity
                    key={b}
                    style={[styles.bidChip, disabled && styles.bidChipDisabled]}
                    onPress={() => !disabled && handleBid(b)}
                    disabled={disabled}
                  >
                    <Text style={[styles.bidChipText, disabled && { opacity: 0.3 }]}>{b}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* Trick area */}
      {!isBidding && (
        <View style={styles.trickArea}>
          {gameState.currentTrick.map(({ seatIndex, card }) => (
            <View key={`${card.suit}${card.rank}`} style={styles.trickCard}>
              <Text style={[styles.trickCardText, (card.suit === Suit.Hearts || card.suit === Suit.Diamonds) && styles.redText]}>
                {RANK_DISPLAY[card.rank]}{SUIT_SYMBOL[card.suit]}
              </Text>
            </View>
          ))}
          {gameState.currentTrick.length === 0 && (
            <Text style={styles.muted}>
              {isMyTurn ? 'Your turn — play a card' : `Waiting for ${gameState.players[gameState.currentPlayerSeat]?.displayName}`}
            </Text>
          )}
        </View>
      )}

      {/* Status */}
      {!isBidding && (
        <Text style={[styles.status, isMyTurn && styles.statusActive]}>
          {isMyTurn ? 'Your turn' : `Waiting for ${gameState.players[gameState.currentPlayerSeat]?.displayName}`}
        </Text>
      )}

      {/* My hand */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hand}>
        {gameState.myHand.map((card) => {
          const legal = gameState.legalMoves.some((m) => m.suit === card.suit && m.rank === card.rank);
          const isRed = card.suit === Suit.Hearts || card.suit === Suit.Diamonds;
          const dimmed = isMyTurn && !legal;
          return (
            <TouchableOpacity
              key={`${card.suit}${card.rank}`}
              style={[styles.card, dimmed ? styles.cardDisabled : null]}
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
  container: { flex: 1, backgroundColor: colors.bgTable, paddingTop: 50, paddingHorizontal: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary },
  muted: { color: colors.textMuted, fontSize: 13 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 8, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 8 },
  headerText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },

  // Scoreboard
  scoreboard: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: 8, marginBottom: 8 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6 },
  scoreRowActive: { backgroundColor: 'rgba(129,182,76,0.12)' },
  scoreIcon: { width: 20, textAlign: 'center', fontSize: 11, color: colors.textMuted },
  scoreName: { flex: 1, fontSize: 12, color: colors.textPrimary, fontWeight: '500' },
  scoreBid: { fontSize: 11, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  scoreTotal: { width: 30, textAlign: 'right', fontSize: 13, fontWeight: 'bold', color: colors.textPrimary, fontVariant: ['tabular-nums'] },

  // Bidding
  biddingArea: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 16 },
  biddingTitle: { color: colors.accentGreen, fontSize: 15, fontWeight: '600', marginBottom: 16 },
  bidButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  bidChip: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: colors.borderSubtle, justifyContent: 'center', alignItems: 'center' },
  bidChipDisabled: { opacity: 0.25 },
  bidChipText: { color: colors.textPrimary, fontSize: 18, fontWeight: 'bold' },

  // Trick area
  trickArea: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8 },
  trickCard: { backgroundColor: '#f7f6f5', borderRadius: 6, width: 44, height: 60, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  trickCardText: { fontSize: 14, fontWeight: 'bold', color: '#1a1a1a' },
  redText: { color: '#c33' },

  // Status
  status: { textAlign: 'center', color: colors.textMuted, fontSize: 13, marginVertical: 8 },
  statusActive: { color: colors.accentGreen, fontWeight: '600' },

  // Hand
  hand: { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingBottom: 30, paddingTop: 4 },
  card: { backgroundColor: '#f7f6f5', borderRadius: 6, width: 50, height: 72, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#c8c5c1', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, elevation: 2 },
  cardDisabled: { opacity: 0.3 },
  cardRank: { fontSize: 16, fontWeight: 'bold', color: '#1a1a1a' },
  cardSuit: { fontSize: 20, color: '#1a1a1a', marginTop: -2 },

  // Game over
  gameOverContainer: { flex: 1, backgroundColor: colors.bgPrimary, justifyContent: 'center', alignItems: 'center', padding: 24 },
  gameOverTitle: { fontSize: 28, fontWeight: 'bold', color: colors.accentGold, marginBottom: 8 },
  gameOverWinner: { fontSize: 16, color: colors.textPrimary, marginBottom: 20 },
  gameOverScores: { alignSelf: 'stretch', backgroundColor: colors.bgSecondary, borderRadius: 12, padding: 16, marginBottom: 24 },
  gameOverScoreRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  gameOverName: { color: colors.textSecondary, fontSize: 14, flex: 1 },
  gameOverScore: { color: colors.textPrimary, fontSize: 16, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  gameOverButtons: { flexDirection: 'row', gap: 12 },
  playAgainBtn: { backgroundColor: colors.accentGreen, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12 },
  playAgainText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  lobbyBtn: { borderWidth: 1, borderColor: colors.borderSubtle, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12 },
  lobbyText: { color: colors.textSecondary, fontSize: 16 },
});
