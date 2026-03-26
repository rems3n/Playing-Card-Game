import { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@card-game/shared-types';
import { GamePhase, AIDifficulty, GameType } from '@card-game/shared-types';
import { GameService } from '../services/GameService.js';
import { PersistenceService } from '../services/PersistenceService.js';
import { PresenceService } from '../services/PresenceService.js';
import { MatchmakingService } from '../services/MatchmakingService.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

const persistenceService = new PersistenceService();
const presenceService = new PresenceService();
const matchmakingService = new MatchmakingService();

const PLAYERS_PER_GAME: Record<string, number> = {
  hearts: 4,
  spades: 4,
  euchre: 4,
};

export function setupGameHandlers(
  io: GameServer,
  gameService: GameService,
): void {
  io.on('connection', (socket: GameSocket) => {
    console.log(`Client connected: ${socket.id}`);
    const userId = socket.data?.user?.id ?? null;
    const displayName = socket.data?.displayName ?? 'Guest';

    // Track presence
    if (userId) {
      presenceService.setOnline(userId, socket.id);
    }

    // ── Create a game (vs AI) ──
    socket.on('lobby:create_game', async (data) => {
      try {
        const gameId = gameService.createGame(
          data.gameType,
          data.config,
          data.aiDifficulty,
        );

        const seat = gameService.joinGame(gameId, socket.id, displayName, userId ?? undefined);
        await socket.join(gameId);

        if (data.fillWithAI !== false) {
          gameService.fillWithAI(
            gameId,
            data.aiDifficulty ?? AIDifficulty.Beginner,
          );
        }

        socket.emit('lobby:game_created', { gameId });

        gameService.startGame(gameId);

        const state = gameService.getVisibleState(gameId, seat);
        socket.emit('game:state', state);

        await handleAITurns(io, gameService, gameId);
      } catch (err: any) {
        socket.emit('game:error', {
          code: 'CREATE_FAILED',
          message: err.message,
        });
      }
    });

    // ── Join matchmaking queue ──
    socket.on('matchmaking:join', async (data) => {
      try {
        const gameType = data.gameType;

        await matchmakingService.joinQueue(gameType, {
          socketId: socket.id,
          userId,
          displayName,
          rating: 1500, // TODO: fetch real rating
          joinedAt: Date.now(),
        });

        const position = await matchmakingService.getPosition(gameType, socket.id);
        socket.emit('matchmaking:waiting', { position: position ?? 1 });

        // Try to find a match — need at least 2 human players, fill rest with AI
        const MIN_HUMANS = 2;
        const totalPlayers = PLAYERS_PER_GAME[gameType] ?? 4;
        const queueSize = await matchmakingService.getQueueSize(gameType);

        if (queueSize >= MIN_HUMANS) {
          // Pull up to totalPlayers humans from queue, or as many as available
          const humanCount = Math.min(queueSize, totalPlayers);
          const matched = await matchmakingService.tryMatch(gameType, humanCount);

          if (matched) {
            const gameId = gameService.createGame(gameType as GameType);

            for (const entry of matched) {
              gameService.joinGame(
                gameId,
                entry.socketId,
                entry.displayName,
                entry.userId ?? undefined,
              );

              const entrySocket = io.sockets.sockets.get(entry.socketId);
              if (entrySocket) {
                await entrySocket.join(gameId);
              }
            }

            // Fill remaining seats with AI
            if (matched.length < totalPlayers) {
              gameService.fillWithAI(gameId, AIDifficulty.Intermediate);
            }

            gameService.startGame(gameId);

            // Notify all matched players
            for (const entry of matched) {
              const entrySocket = io.sockets.sockets.get(entry.socketId);
              if (entrySocket) {
                const seat = gameService.getSeatForSocket(gameId, entry.socketId);
                if (seat !== undefined) {
                  entrySocket.emit('matchmaking:found', {
                    gameId,
                    opponents: matched
                      .filter((m) => m.socketId !== entry.socketId)
                      .map((m) => ({
                        displayName: m.displayName,
                        seatIndex: gameService.getSeatForSocket(gameId, m.socketId) ?? 0,
                      })),
                  });
                  entrySocket.emit('game:state', gameService.getVisibleState(gameId, seat));
                }
              }
            }

            // Execute AI turns if needed (passing/bidding phase)
            await handleAITurns(io, gameService, gameId);
          }
        }
      } catch (err: any) {
        socket.emit('game:error', {
          code: 'MATCHMAKING_FAILED',
          message: err.message,
        });
      }
    });

    // ── Cancel matchmaking ──
    socket.on('matchmaking:cancel', async () => {
      await matchmakingService.leaveAllQueues(socket.id);
    });

    // ── Join an existing game ──
    socket.on('game:join', async (data) => {
      try {
        const { gameId } = data;
        const seat = gameService.joinGame(gameId, socket.id, displayName, userId ?? undefined);
        await socket.join(gameId);

        const state = gameService.getVisibleState(gameId, seat);
        socket.emit('game:state', state);

        io.to(gameId).emit('game:player_reconnected', { seatIndex: seat });
      } catch (err: any) {
        socket.emit('game:error', {
          code: 'JOIN_FAILED',
          message: err.message,
        });
      }
    });

    // ── Play a card ──
    socket.on('game:play_card', async (data) => {
      try {
        const { gameId, card } = data;
        const seat = gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit('game:error', { code: 'NOT_IN_GAME', message: 'You are not in this game' });
          return;
        }

        gameService.playCard(gameId, seat, card);

        const room = gameService.getRoom(gameId)!;
        const state = room.engine.getState();

        io.to(gameId).emit('game:card_played', {
          seatIndex: seat,
          card,
          nextSeat: state.currentPlayerSeat,
        });

        if (state.phase === GamePhase.TrickResolution || state.currentTrick.length === 0) {
          const events = room.engine.getEvents();
          const lastTrickEvent = [...events].reverse().find((e) => e.type === 'trick_completed');
          if (lastTrickEvent) {
            io.to(gameId).emit('game:trick_complete', {
              winningSeat: lastTrickEvent.seatIndex!,
              cards: lastTrickEvent.payload.cards as any,
              points: lastTrickEvent.payload.points as number,
            });
            // Pause so players can see the completed trick before clearing
            await new Promise((r) => setTimeout(r, 2500));
          }
        }

        if (state.phase === GamePhase.RoundScoring || state.phase === GamePhase.Passing || state.phase === GamePhase.Dealing) {
          io.to(gameId).emit('game:round_end', {
            roundScores: state.roundScores,
            totalScores: state.scores,
          });
        }

        if (state.phase === GamePhase.GameOver) {
          const winner = room.engine.getWinnerSeat();
          const ratingChanges = await persistenceService.saveCompletedGame(gameId, room, winner);
          io.to(gameId).emit('game:over', {
            finalScores: state.scores,
            winnerSeat: winner,
            ratingChanges: ratingChanges.map((r) => ({
              userId: r.userId,
              gameType: state.gameType as any,
              before: r.before,
              after: r.after,
              change: r.change,
            })),
          });
          return;
        }

        broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);
      } catch (err: any) {
        socket.emit('game:error', { code: 'PLAY_FAILED', message: err.message });
      }
    });

    // ── Pass cards (Hearts) ──
    socket.on('game:pass_cards', async (data) => {
      try {
        const { gameId, cards } = data;
        const seat = gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit('game:error', { code: 'NOT_IN_GAME', message: 'You are not in this game' });
          return;
        }

        gameService.passCards(gameId, seat, cards);

        const phase = gameService.getPhase(gameId);
        if (phase === GamePhase.Playing) {
          broadcastStates(io, gameService, gameId);
          await handleAITurns(io, gameService, gameId);
        }
      } catch (err: any) {
        socket.emit('game:error', { code: 'PASS_FAILED', message: err.message });
      }
    });

    // ── Bid (Spades) ──
    socket.on('game:bid', async (data) => {
      try {
        const { gameId, bid } = data;
        const seat = gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit('game:error', { code: 'NOT_IN_GAME', message: 'You are not in this game' });
          return;
        }

        gameService.placeBid(gameId, seat, typeof bid === 'number' ? bid : 0);

        broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);

        // After AI bidding, broadcast again and start AI playing if needed
        broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);
      } catch (err: any) {
        socket.emit('game:error', { code: 'BID_FAILED', message: err.message });
      }
    });

    // ── Call trump (Euchre) ──
    socket.on('game:call_trump', async (data) => {
      try {
        const { gameId, suit } = data;
        const seat = gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit('game:error', { code: 'NOT_IN_GAME', message: 'You are not in this game' });
          return;
        }

        gameService.callTrump(gameId, seat, suit as any);

        broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);

        // After AI trump calling, broadcast and handle AI plays
        broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);
      } catch (err: any) {
        socket.emit('game:error', { code: 'TRUMP_FAILED', message: err.message });
      }
    });

    // ── In-game chat ──
    socket.on('chat:message', (data) => {
      const { gameId, text } = data;
      const seat = gameService.getSeatForSocket(gameId, socket.id);
      if (seat === undefined) return;

      io.to(gameId).emit('chat:message', {
        seatIndex: seat,
        displayName,
        text,
        timestamp: Date.now(),
      });
    });

    // ── Disconnect ──
    socket.on('disconnect', async () => {
      console.log(`Client disconnected: ${socket.id}`);

      // Clean up presence
      if (userId) {
        const disconnectedUser = await presenceService.setOffline(socket.id);
        if (disconnectedUser) {
          // Notify friends this user went offline
          io.emit('presence:update', { userId: disconnectedUser, online: false });
        }
      }

      // Clean up matchmaking
      await matchmakingService.leaveAllQueues(socket.id);
    });
  });
}

async function handleAITurns(
  io: GameServer,
  gameService: GameService,
  gameId: string,
): Promise<void> {
  await gameService.executeAITurns(gameId, (seatIndex, card) => {
    // Broadcast each AI card play individually so clients see them appear
    const room = gameService.getRoom(gameId);
    if (!room) return;
    const state = room.engine.getState();

    io.to(gameId).emit('game:card_played', {
      seatIndex,
      card,
      nextSeat: state.currentPlayerSeat,
    });

    // Send updated visible state to each human player
    for (const [seat, socketId] of room.playerSockets) {
      io.to(socketId).emit('game:state', gameService.getVisibleState(gameId, seat));
    }
  });

  const room = gameService.getRoom(gameId);
  if (!room) return;

  const state = room.engine.getState();

  if (state.phase === GamePhase.GameOver) {
    const winner = room.engine.getWinnerSeat();
    const ratingChanges = await persistenceService.saveCompletedGame(gameId, room, winner);
    io.to(gameId).emit('game:over', {
      finalScores: state.scores,
      winnerSeat: winner,
      ratingChanges: ratingChanges.map((r) => ({
        userId: r.userId,
        gameType: state.gameType as any,
        before: r.before,
        after: r.after,
        change: r.change,
      })),
    });
    return;
  }

  broadcastStates(io, gameService, gameId);
}

function broadcastStates(
  io: GameServer,
  gameService: GameService,
  gameId: string,
): void {
  const room = gameService.getRoom(gameId);
  if (!room) return;

  for (const [seat, socketId] of room.playerSockets) {
    const state = gameService.getVisibleState(gameId, seat);
    io.to(socketId).emit('game:state', state);
  }
}
