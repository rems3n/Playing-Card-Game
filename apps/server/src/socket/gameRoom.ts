import { v4 as uuidv4 } from 'uuid';
import { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  WaitingRoomState,
  WaitingRoomPlayer,
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

// ── Waiting rooms ──
interface WaitingRoom {
  id: string;
  gameType: GameType;
  hostSocketId: string;
  hostDisplayName: string;
  players: Array<{ socketId: string; displayName: string; userId: string | null }>;
  maxPlayers: number;
}

const waitingRooms = new Map<string, WaitingRoom>();
const disconnectTimers = new Map<string, NodeJS.Timeout>(); // `gameId:seat` → timer
const RECONNECT_TIMEOUT = 30_000; // 30 seconds
const MATCH_ACCEPT_TIMEOUT = 15_000; // 15 seconds to accept

// Pending match proposals
interface PendingMatch {
  matchId: string;
  gameType: GameType;
  players: Array<{ socketId: string; displayName: string; userId: string | null }>;
  accepted: Set<string>; // socketIds that accepted
  timer: NodeJS.Timeout;
}
const pendingMatches = new Map<string, PendingMatch>();

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

        // Handle AI turns (passing in Hearts, bidding in Spades/Euchre)
        await handleAITurns(io, gameService, gameId);
        broadcastStates(io, gameService, gameId);

        // If AI bidding finished and transitioned to playing, handle AI card plays
        const phase = gameService.getPhase(gameId);
        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
        }
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
          rating: 1500,
          joinedAt: Date.now(),
        });

        const position = await matchmakingService.getPosition(gameType, socket.id);
        socket.emit('matchmaking:waiting', { position: position ?? 1 });

        // Try to propose a match — need at least 2 humans
        const MIN_HUMANS = 2;
        const totalPlayers = PLAYERS_PER_GAME[gameType] ?? 4;
        const queueSize = await matchmakingService.getQueueSize(gameType);

        if (queueSize >= MIN_HUMANS) {
          const humanCount = Math.min(queueSize, totalPlayers);
          const matched = await matchmakingService.tryMatch(gameType, humanCount);

          if (matched) {
            // Create a match proposal — players must accept
            const matchId = uuidv4().slice(0, 8);
            const players = matched.map((m) => ({
              socketId: m.socketId,
              displayName: m.displayName,
              userId: m.userId,
            }));

            const timer = setTimeout(() => {
              // Timeout — decline the match, put players back in queue
              const pending = pendingMatches.get(matchId);
              if (!pending) return;
              pendingMatches.delete(matchId);

              for (const player of pending.players) {
                const s = io.sockets.sockets.get(player.socketId);
                if (s) {
                  s.emit('matchmaking:declined', { matchId, reason: 'Timed out — not all players accepted' });
                  // Put them back in queue
                  matchmakingService.joinQueue(gameType, {
                    socketId: player.socketId,
                    userId: player.userId,
                    displayName: player.displayName,
                    rating: 1500,
                    joinedAt: Date.now(),
                  });
                }
              }
            }, MATCH_ACCEPT_TIMEOUT);

            pendingMatches.set(matchId, {
              matchId,
              gameType: gameType as GameType,
              players,
              accepted: new Set(),
              timer,
            });

            // Notify all matched players — they must accept
            for (const player of players) {
              const s = io.sockets.sockets.get(player.socketId);
              if (s) {
                s.emit('matchmaking:proposed', {
                  matchId,
                  gameType: gameType as GameType,
                  players: players.map((p) => ({ displayName: p.displayName })),
                  expiresIn: MATCH_ACCEPT_TIMEOUT / 1000,
                });
              }
            }
          }
        }
      } catch (err: any) {
        socket.emit('game:error', { code: 'MATCHMAKING_FAILED', message: err.message });
      }
    });

    // ── Accept a match proposal ──
    socket.on('matchmaking:accept', async (data) => {
      const pending = pendingMatches.get(data.matchId);
      if (!pending) return;

      pending.accepted.add(socket.id);

      // Notify others of progress
      for (const player of pending.players) {
        const s = io.sockets.sockets.get(player.socketId);
        if (s) {
          s.emit('matchmaking:accepted', {
            matchId: data.matchId,
            acceptedCount: pending.accepted.size,
            totalCount: pending.players.length,
          });
        }
      }

      // Check if everyone accepted
      if (pending.accepted.size === pending.players.length) {
        clearTimeout(pending.timer);
        pendingMatches.delete(data.matchId);

        // Create the game
        const totalPlayers = PLAYERS_PER_GAME[pending.gameType] ?? 4;
        const gameId = gameService.createGame(pending.gameType);

        for (const player of pending.players) {
          gameService.joinGame(gameId, player.socketId, player.displayName, player.userId ?? undefined);
          const s = io.sockets.sockets.get(player.socketId);
          if (s) await s.join(gameId);
        }

        if (pending.players.length < totalPlayers) {
          gameService.fillWithAI(gameId, AIDifficulty.Intermediate);
        }

        gameService.startGame(gameId);

        // Notify all players
        for (const player of pending.players) {
          const s = io.sockets.sockets.get(player.socketId);
          if (s) {
            const seat = gameService.getSeatForSocket(gameId, player.socketId);
            if (seat !== undefined) {
              s.emit('matchmaking:found', {
                gameId,
                opponents: pending.players
                  .filter((p) => p.socketId !== player.socketId)
                  .map((p) => ({ displayName: p.displayName, seatIndex: gameService.getSeatForSocket(gameId, p.socketId) ?? 0 })),
              });
              s.emit('game:state', gameService.getVisibleState(gameId, seat));
            }
          }
        }

        await handleAITurns(io, gameService, gameId);
      }
    });

    // ── Decline a match proposal ──
    socket.on('matchmaking:decline', async (data) => {
      const pending = pendingMatches.get(data.matchId);
      if (!pending) return;

      clearTimeout(pending.timer);
      pendingMatches.delete(data.matchId);

      // Put non-declining players back in queue, notify everyone
      for (const player of pending.players) {
        const s = io.sockets.sockets.get(player.socketId);
        if (s) {
          if (player.socketId === socket.id) {
            s.emit('matchmaking:declined', { matchId: data.matchId, reason: 'You declined' });
          } else {
            s.emit('matchmaking:declined', { matchId: data.matchId, reason: 'A player declined' });
            // Put them back in queue
            matchmakingService.joinQueue(pending.gameType, {
              socketId: player.socketId,
              userId: player.userId,
              displayName: player.displayName,
              rating: 1500,
              joinedAt: Date.now(),
            });
          }
        }
      }
    });

    // ── Cancel matchmaking ──
    socket.on('matchmaking:cancel', async () => {
      await matchmakingService.leaveAllQueues(socket.id);

      // Also decline any pending matches
      for (const [matchId, pending] of pendingMatches) {
        if (pending.players.some((p) => p.socketId === socket.id)) {
          socket.emit('matchmaking:decline' as any, { matchId });
        }
      }
    });

    // ── Create a waiting room ──
    socket.on('room:create', async (data) => {
      const roomId = uuidv4().slice(0, 8); // short room code
      const maxPlayers = PLAYERS_PER_GAME[data.gameType] ?? 4;

      const room: WaitingRoom = {
        id: roomId,
        gameType: data.gameType as GameType,
        hostSocketId: socket.id,
        hostDisplayName: displayName,
        players: [{ socketId: socket.id, displayName, userId }],
        maxPlayers,
      };

      waitingRooms.set(roomId, room);
      await socket.join(`room:${roomId}`);
      socket.emit('room:created', { roomId });
      io.to(`room:${roomId}`).emit('room:update', toRoomState(room));
    });

    // ── Join a waiting room ──
    socket.on('room:join', async (data) => {
      const room = waitingRooms.get(data.roomId);
      if (!room) {
        socket.emit('room:error', { message: 'Room not found' });
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        socket.emit('room:error', { message: 'Room is full' });
        return;
      }
      if (room.players.some((p) => p.socketId === socket.id)) {
        // Already in room
        socket.emit('room:update', toRoomState(room));
        return;
      }

      room.players.push({ socketId: socket.id, displayName, userId });
      await socket.join(`room:${room.id}`);
      io.to(`room:${room.id}`).emit('room:update', toRoomState(room));
    });

    // ── Leave a waiting room ──
    socket.on('room:leave', async (data) => {
      const room = waitingRooms.get(data.roomId);
      if (!room) return;

      room.players = room.players.filter((p) => p.socketId !== socket.id);
      socket.leave(`room:${room.id}`);

      if (room.players.length === 0) {
        waitingRooms.delete(room.id);
      } else {
        // If host left, make next player host
        if (room.hostSocketId === socket.id) {
          room.hostSocketId = room.players[0].socketId;
          room.hostDisplayName = room.players[0].displayName;
        }
        io.to(`room:${room.id}`).emit('room:update', toRoomState(room));
      }
    });

    // ── Host starts the game ──
    socket.on('room:start', async (data) => {
      const room = waitingRooms.get(data.roomId);
      if (!room) {
        socket.emit('room:error', { message: 'Room not found' });
        return;
      }
      if (room.hostSocketId !== socket.id) {
        socket.emit('room:error', { message: 'Only the host can start' });
        return;
      }
      if (room.players.length < 2) {
        socket.emit('room:error', { message: 'Need at least 2 players' });
        return;
      }

      // Create the actual game
      const gameId = gameService.createGame(room.gameType);

      for (const player of room.players) {
        gameService.joinGame(gameId, player.socketId, player.displayName, player.userId ?? undefined);
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket) {
          await playerSocket.join(gameId);
        }
      }

      // Fill remaining seats with AI
      if (room.players.length < room.maxPlayers) {
        gameService.fillWithAI(gameId, AIDifficulty.Intermediate);
      }

      gameService.startGame(gameId);

      // Notify all players
      io.to(`room:${room.id}`).emit('room:started', { gameId });

      // Send game state to each player
      for (const player of room.players) {
        const seat = gameService.getSeatForSocket(gameId, player.socketId);
        if (seat !== undefined) {
          const playerSocket = io.sockets.sockets.get(player.socketId);
          if (playerSocket) {
            playerSocket.emit('game:state', gameService.getVisibleState(gameId, seat));
          }
        }
      }

      // Clean up room
      waitingRooms.delete(room.id);

      // Handle AI turns
      await handleAITurns(io, gameService, gameId);
    });

    // ── Join an existing game ──
    socket.on('game:join', async (data) => {
      try {
        const { gameId } = data;
        const seat = gameService.joinGame(gameId, socket.id, displayName, userId ?? undefined);
        await socket.join(gameId);

        // Cancel any pending disconnect timer for this seat
        const timerKey = `${gameId}:${seat}`;
        const existingTimer = disconnectTimers.get(timerKey);
        if (existingTimer) {
          clearTimeout(existingTimer);
          disconnectTimers.delete(timerKey);
          console.log(`Player reconnected to seat ${seat} in game ${gameId}`);
        }

        // Mark as connected
        const room = gameService.getRoom(gameId);
        if (room) {
          room.engine.getState().players[seat].isConnected = true;
        }

        const state = gameService.getVisibleState(gameId, seat);
        socket.emit('game:state', state);

        io.to(gameId).emit('game:player_reconnected', { seatIndex: seat });

        // Broadcast updated state to all players (shows reconnected status)
        broadcastStates(io, gameService, gameId);
      } catch (err: any) {
        socket.emit('game:error', {
          code: 'JOIN_FAILED',
          message: err.message,
        });
      }
    });

    // ── Play a card ──
    // ── Replace disconnected player with AI ──
    socket.on('game:replace_with_ai', async (data) => {
      const { gameId, seatIndex } = data;
      gameService.replaceWithAI(gameId, seatIndex);

      // Cancel the timer
      const timerKey = `${gameId}:${seatIndex}`;
      const timer = disconnectTimers.get(timerKey);
      if (timer) { clearTimeout(timer); disconnectTimers.delete(timerKey); }

      // Broadcast updated state
      broadcastStates(io, gameService, gameId);

      // If it was the AI's turn, execute AI turns
      const room = gameService.getRoom(gameId);
      if (room) {
        const state = room.engine.getState();
        if (state.phase === GamePhase.Playing && room.aiPlayers.has(state.currentPlayerSeat)) {
          await handleAITurns(io, gameService, gameId);
        }
      }
    });

    // ── End game early ──
    socket.on('game:end', async (data) => {
      const { gameId } = data;
      const room = gameService.getRoom(gameId);
      if (!room) return;

      io.to(gameId).emit('game:over', {
        finalScores: room.engine.getState().scores,
        winnerSeat: -1, // no winner
      });
      gameService.removeGame(gameId);
    });

    // ── Leave a game (voluntary) ──
    socket.on('game:leave', async (data) => {
      const { gameId } = data;
      const seat = gameService.handlePlayerDisconnect(gameId, socket.id);
      if (seat === -1) return;

      socket.leave(gameId);

      // Notify others this player left
      io.to(gameId).emit('game:player_disconnected', {
        seatIndex: seat,
        timeoutSeconds: 30,
      });

      // Start reconnect timer
      startDisconnectTimer(io, gameService, gameId, seat);
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

        // Handle AI bidding (if more AI need to bid after the human)
        await handleAITurns(io, gameService, gameId);
        broadcastStates(io, gameService, gameId);

        // If bidding finished and transitioned to playing, handle AI plays
        const phase = gameService.getPhase(gameId);
        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
        }
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

        // Handle remaining AI trump calls
        await handleAITurns(io, gameService, gameId);
        broadcastStates(io, gameService, gameId);

        // If trump calling finished and transitioned to playing, handle AI plays
        const phase = gameService.getPhase(gameId);
        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
        }
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
          io.emit('presence:update', { userId: disconnectedUser, online: false });
        }
      }

      // Clean up matchmaking
      await matchmakingService.leaveAllQueues(socket.id);

      // Handle mid-game disconnect — start reconnect timer
      const gameInfo = gameService.findGameBySocket(socket.id);
      if (gameInfo) {
        const { gameId, seat } = gameInfo;
        gameService.handlePlayerDisconnect(gameId, socket.id);

        io.to(gameId).emit('game:player_disconnected', {
          seatIndex: seat,
          timeoutSeconds: 30,
        });

        startDisconnectTimer(io, gameService, gameId, seat);
      }

      // Clean up waiting rooms
      for (const [roomId, room] of waitingRooms) {
        const idx = room.players.findIndex((p) => p.socketId === socket.id);
        if (idx !== -1) {
          room.players.splice(idx, 1);
          if (room.players.length === 0) {
            waitingRooms.delete(roomId);
          } else {
            if (room.hostSocketId === socket.id) {
              room.hostSocketId = room.players[0].socketId;
              room.hostDisplayName = room.players[0].displayName;
            }
            io.to(`room:${roomId}`).emit('room:update', toRoomState(room));
          }
        }
      }
    });
  });
}

function toRoomState(room: WaitingRoom): WaitingRoomState {
  return {
    roomId: room.id,
    gameType: room.gameType,
    host: room.hostDisplayName,
    players: room.players.map((p, i) => ({
      displayName: p.displayName,
      avatarUrl: null,
      isHost: p.socketId === room.hostSocketId,
      seatIndex: i,
    })),
    maxPlayers: room.maxPlayers,
    fillWithAI: room.players.length < room.maxPlayers,
  };
}

function startDisconnectTimer(
  io: GameServer,
  gameService: GameService,
  gameId: string,
  seat: number,
): void {
  const timerKey = `${gameId}:${seat}`;

  // Clear any existing timer for this seat
  const existing = disconnectTimers.get(timerKey);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    disconnectTimers.delete(timerKey);

    const room = gameService.getRoom(gameId);
    if (!room) return;

    const player = room.engine.getState().players[seat];
    if (player.isConnected) return; // They reconnected

    console.log(`Reconnect timeout for seat ${seat} in game ${gameId}`);

    // Notify remaining players — they can choose to continue or quit
    // For now, we emit a special event. The client shows a modal.
    io.to(gameId).emit('game:player_disconnected', {
      seatIndex: seat,
      timeoutSeconds: 0, // 0 = timer expired
    });
  }, RECONNECT_TIMEOUT);

  disconnectTimers.set(timerKey, timer);
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
