import { v4 as uuidv4 } from "uuid";
import { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  WaitingRoomState,
  WaitingRoomPlayer,
  GameConfig,
} from "@card-game/shared-types";
import { GamePhase, AIDifficulty, GameType } from "@card-game/shared-types";
import { GameService } from "../services/GameService.js";
import { PersistenceService } from "../services/PersistenceService.js";
import { RoomService, type FamilyRoom } from "../services/RoomService.js";
import { PresenceService } from "../services/PresenceService.js";
import { MatchmakingService } from "../services/MatchmakingService.js";
import {
  MediaAuthorizationError,
  MediaService,
} from "../services/MediaService.js";
import { createMediaProvider } from "../services/media/index.js";
import { env } from "../config/env.js";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

const persistenceService = new PersistenceService();
const presenceService = new PresenceService();
const matchmakingService = new MatchmakingService();
const defaultMediaService = new MediaService(
  createMediaProvider(env),
  env.MEDIA_TOKEN_TTL_SECONDS,
);

const PLAYERS_PER_GAME: Record<string, number> = {
  hearts: 4,
  spades: 4,
  euchre: 4,
  rummy: 4, // default; overridden by config.maxPlayers
  "seven-six": 4, // default; overridden by config.maxPlayers
};

const disconnectTimers = new Map<string, NodeJS.Timeout>(); // `gameId:seat` → timer
const RECONNECT_TIMEOUT = 30_000; // 30 seconds
const MATCH_ACCEPT_TIMEOUT = 15_000; // 15 seconds to accept

// Pending match proposals
interface PendingMatch {
  matchId: string;
  gameType: GameType;
  players: Array<{
    socketId: string;
    displayName: string;
    userId: string | null;
  }>;
  accepted: Set<string>; // socketIds that accepted
  timer: NodeJS.Timeout;
}
const pendingMatches = new Map<string, PendingMatch>();

export function setupGameHandlers(
  io: GameServer,
  gameService: GameService,
  rooms = new RoomService(),
  media: MediaService = defaultMediaService,
): void {
  io.on("connection", (socket: GameSocket) => {
    console.log(`Client connected: ${socket.id}`);
    const userId = socket.data?.user?.id ?? null;
    const displayName = socket.data?.displayName ?? "Guest";
    const participantId = socket.data?.participantId ?? socket.id;

    // Track presence
    if (userId) {
      presenceService.setOnline(userId, socket.id);
    }

    // ── Create a game (vs AI) ──
    socket.on("lobby:create_game", async (data) => {
      try {
        const gameId = gameService.createGame(
          data.gameType,
          data.config,
          data.aiDifficulty,
        );

        const previous = await gameService.getRoom(gameId);
        if (previous)
          for (const [seat, oldSocket] of previous.playerSockets) {
            if (
              previous.participants.get(seat) === participantId &&
              oldSocket !== socket.id
            )
              await io.sockets.sockets.get(oldSocket)?.leave(gameId);
          }
        const seat = await gameService.joinGame(
          gameId,
          socket.id,
          displayName,
          userId ?? undefined,
          participantId,
        );
        await socket.join(gameId);

        if (data.fillWithAI !== false) {
          await gameService.fillWithAI(
            gameId,
            data.aiDifficulty ?? AIDifficulty.Beginner,
          );
        }

        socket.emit("lobby:game_created", { gameId });

        await gameService.startGame(gameId);

        const state = await gameService.getVisibleState(gameId, seat);
        socket.emit("game:state", state);

        // Handle AI turns (passing in Hearts, bidding in Spades/Euchre)
        await handleAITurns(io, gameService, gameId);
        await broadcastStates(io, gameService, gameId);

        // If AI bidding finished and transitioned to playing, handle AI card plays
        const phase = await gameService.getPhase(gameId);
        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
        }
      } catch (err: any) {
        socket.emit("game:error", {
          code: "CREATE_FAILED",
          message: err.message,
        });
      }
    });

    // ── Join matchmaking queue ──
    socket.on("matchmaking:join", async (data) => {
      try {
        const gameType = data.gameType;

        await matchmakingService.joinQueue(gameType, {
          socketId: socket.id,
          userId,
          displayName,
          rating: 1500,
          joinedAt: Date.now(),
        });

        const position = await matchmakingService.getPosition(
          gameType,
          socket.id,
        );
        socket.emit("matchmaking:waiting", { position: position ?? 1 });

        // Try to propose a match — need at least 2 humans
        const MIN_HUMANS = 2;
        const totalPlayers = PLAYERS_PER_GAME[gameType] ?? 4;
        const queueSize = await matchmakingService.getQueueSize(gameType);

        if (queueSize >= MIN_HUMANS) {
          const humanCount = Math.min(queueSize, totalPlayers);
          const matched = await matchmakingService.tryMatch(
            gameType,
            humanCount,
          );

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
                  s.emit("matchmaking:declined", {
                    matchId,
                    reason: "Timed out — not all players accepted",
                  });
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
                s.emit("matchmaking:proposed", {
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
        socket.emit("game:error", {
          code: "MATCHMAKING_FAILED",
          message: err.message,
        });
      }
    });

    // ── Accept a match proposal ──
    socket.on("matchmaking:accept", async (data) => {
      const pending = pendingMatches.get(data.matchId);
      if (!pending) return;

      pending.accepted.add(socket.id);

      // Notify others of progress
      for (const player of pending.players) {
        const s = io.sockets.sockets.get(player.socketId);
        if (s) {
          s.emit("matchmaking:accepted", {
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
          await gameService.joinGame(
            gameId,
            player.socketId,
            player.displayName,
            player.userId ?? undefined,
            io.sockets.sockets.get(player.socketId)?.data.participantId ??
              player.socketId,
          );
          const s = io.sockets.sockets.get(player.socketId);
          if (s) await s.join(gameId);
        }

        if (pending.players.length < totalPlayers) {
          await gameService.fillWithAI(gameId, AIDifficulty.Intermediate);
        }

        await gameService.startGame(gameId);

        // Notify all players
        for (const player of pending.players) {
          const s = io.sockets.sockets.get(player.socketId);
          if (s) {
            const seat = await gameService.getSeatForSocket(
              gameId,
              player.socketId,
            );
            if (seat !== undefined) {
              const opponents = [];
              for (const p of pending.players.filter(
                (p) => p.socketId !== player.socketId,
              )) {
                const pSeat = await gameService.getSeatForSocket(
                  gameId,
                  p.socketId,
                );
                opponents.push({
                  displayName: p.displayName,
                  seatIndex: pSeat ?? 0,
                });
              }
              s.emit("matchmaking:found", { gameId, opponents });
              s.emit(
                "game:state",
                await gameService.getVisibleState(gameId, seat),
              );
            }
          }
        }

        await handleAITurns(io, gameService, gameId);
      }
    });

    // ── Decline a match proposal ──
    socket.on("matchmaking:decline", async (data) => {
      const pending = pendingMatches.get(data.matchId);
      if (!pending) return;

      clearTimeout(pending.timer);
      pendingMatches.delete(data.matchId);

      // Put non-declining players back in queue, notify everyone
      for (const player of pending.players) {
        const s = io.sockets.sockets.get(player.socketId);
        if (s) {
          if (player.socketId === socket.id) {
            s.emit("matchmaking:declined", {
              matchId: data.matchId,
              reason: "You declined",
            });
          } else {
            s.emit("matchmaking:declined", {
              matchId: data.matchId,
              reason: "A player declined",
            });
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
    socket.on("matchmaking:cancel", async () => {
      await matchmakingService.leaveAllQueues(socket.id);

      // Also decline any pending matches
      for (const [matchId, pending] of pendingMatches) {
        if (pending.players.some((p) => p.socketId === socket.id)) {
          socket.emit("matchmaking:decline" as any, { matchId });
        }
      }
    });

    const loadRoom = async (id: string) => {
      const room = await rooms.load(id);
      if (room) rooms.reconcile(room, (sid) => io.sockets.sockets.has(sid));
      return room;
    };
    const roomError = (err: unknown) =>
      socket.emit("room:error", {
        message: err instanceof Error ? err.message : "Could not update room",
      });
    const participant = () => ({
      id: participantId,
      socketId: socket.id,
      userId,
      displayName,
      connected: true,
    });
    socket.on("room:create", async (data) => {
      try {
        const room = await rooms.create(
          data.gameType,
          data.config ?? {},
          participant(),
        );
        socket.data.waitingRoomId = room.id;
        await socket.join(`room:${room.id}`);
        socket.emit("room:created", { roomId: room.id });
        broadcastRoomState(io, room);
      } catch (err) {
        roomError(err);
      }
    });
    socket.on("room:join", async (data) => {
      try {
        await rooms.queue.run(String(data.roomId).toLowerCase(), async () => {
          const room = await loadRoom(data.roomId);
          if (!room || !room.players.length)
            throw new Error("Room not found or expired");
          const existing = room.players.find((p) => p.id === participantId);
          if (room.gameId) {
            if (!existing) throw new Error("This game has already started");
            socket.emit("room:started", { gameId: room.gameId });
            return;
          }
          if (!existing && room.players.length >= room.maxPlayers)
            throw new Error("Room is full");
          if (existing) {
            io.sockets.sockets.get(existing.socketId)?.leave(`room:${room.id}`);
            Object.assign(existing, participant(), {
              disconnectedAt: undefined,
            });
          } else room.players.push(participant());
          socket.data.waitingRoomId = room.id;
          await socket.join(`room:${room.id}`);
          await rooms.save(room);
          broadcastRoomState(io, room);
        });
      } catch (err) {
        roomError(err);
      }
    });
    socket.on("room:leave", async (data) => {
      try {
        await rooms.queue.run(String(data.roomId).toLowerCase(), async () => {
          const room = await loadRoom(data.roomId);
          if (!room || room.gameId) return;
          room.players = room.players.filter(
            (p) => p.id !== participantId || p.socketId !== socket.id,
          );
          if (!room.players.some((p) => p.id === room.hostId))
            room.hostId = room.players[0]?.id ?? "";
          await socket.leave(`room:${room.id}`);
          delete socket.data.waitingRoomId;
          await rooms.save(room);
          broadcastRoomState(io, room);
        });
      } catch (err) {
        roomError(err);
      }
    });
    socket.on("room:start", async (data) => {
      let started: string | undefined;
      try {
        await rooms.queue.run(String(data.roomId).toLowerCase(), async () => {
          const room = await loadRoom(data.roomId);
          if (!room) throw new Error("Room not found");
          if (
            room.hostId !== participantId ||
            !room.players.some(
              (p) => p.id === participantId && p.socketId === socket.id,
            )
          )
            throw new Error("Only the host can start");
          if (room.gameId) return;
          if (room.players.length < 2)
            throw new Error("Need at least 2 players");
          if (room.players.some((p) => !io.sockets.sockets.has(p.socketId)))
            throw new Error("Wait for everyone to reconnect before starting");
          const gameId = gameService.createGame(room.gameType, room.config);
          try {
            for (const player of room.players) {
              await gameService.joinGame(
                gameId,
                player.socketId,
                player.displayName,
                player.userId ?? undefined,
                player.id,
              );
              await io.sockets.sockets.get(player.socketId)?.join(gameId);
            }
            if (room.players.length < room.maxPlayers)
              await gameService.fillWithAI(gameId, AIDifficulty.Intermediate);
            await gameService.startGame(gameId);
            room.gameId = gameId;
            await rooms.save(room);
            started = gameId;
            io.to(`room:${room.id}`).emit("room:started", { gameId });
          } catch (err) {
            for (const player of room.players)
              await io.sockets.sockets.get(player.socketId)?.leave(gameId);
            await gameService.removeGame(gameId).catch(() => {});
            throw err;
          }
        });
        if (started) {
          await broadcastStates(io, gameService, started);
          await handleAITurns(io, gameService, started);
        }
      } catch (err) {
        roomError(err);
      }
    });

    // ── Join an existing game ──
    socket.on("game:join", async (data) => {
      try {
        const { gameId } = data;
        const previous = await gameService.getRoom(gameId);
        if (previous)
          for (const [seat, oldSocket] of previous.playerSockets) {
            if (
              previous.participants.get(seat) === participantId &&
              oldSocket !== socket.id
            )
              await io.sockets.sockets.get(oldSocket)?.leave(gameId);
          }
        const seat = await gameService.joinGame(
          gameId,
          socket.id,
          displayName,
          userId ?? undefined,
          participantId,
        );
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
        const room = await gameService.getRoom(gameId);
        if (room) {
          room.engine.getState().players[seat].isConnected = true;
        }

        const state = await gameService.getVisibleState(gameId, seat);
        socket.emit("game:state", state);

        io.to(gameId).emit("game:player_reconnected", { seatIndex: seat });

        // Broadcast updated state to all players (shows reconnected status)
        await broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);
      } catch (err: any) {
        socket.emit("game:error", {
          code: "JOIN_FAILED",
          message: err.message,
        });
      }
    });

    // ── Play a card ──
    // ── Replace disconnected player with AI ──
    socket.on("game:replace_with_ai", async (data) => {
      const { gameId, seatIndex } = data;
      if (
        (await gameService.getSeatForSocket(gameId, socket.id)) === undefined
      ) {
        socket.emit("game:error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }
      try {
        await gameService.replaceWithAI(gameId, seatIndex);
      } catch (err) {
        socket.emit("game:error", {
          code: "REPLACE_FAILED",
          message:
            err instanceof Error ? err.message : "Could not replace player",
        });
        return;
      }

      // Cancel the timer
      const timerKey = `${gameId}:${seatIndex}`;
      const timer = disconnectTimers.get(timerKey);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(timerKey);
      }

      // Broadcast updated state
      broadcastStates(io, gameService, gameId);

      // If it was the AI's turn, execute AI turns
      const room = await gameService.getRoom(gameId);
      if (room) {
        const state = room.engine.getState();
        if (room.aiPlayers.has(state.currentPlayerSeat)) {
          await handleAITurns(io, gameService, gameId);
        }
      }
    });

    // ── End game early ──
    socket.on("game:end", async (data) => {
      const { gameId } = data;
      const room = await gameService.getRoom(gameId);
      if (!room) return;
      if (
        (await gameService.getSeatForSocket(gameId, socket.id)) === undefined
      ) {
        socket.emit("game:error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      io.to(gameId).emit("game:over", {
        gameId,
        finalScores: room.engine.getState().scores,
        winnerSeat: -1, // no winner
      });
      await gameService.removeGame(gameId);
    });

    // ── Leave a game (voluntary) ──
    socket.on("game:leave", async (data) => {
      const { gameId } = data;
      const seat = gameService.handlePlayerDisconnect(gameId, socket.id);
      if (seat === -1) return;

      socket.leave(gameId);

      // Notify others this player left
      io.to(gameId).emit("game:player_disconnected", {
        seatIndex: seat,
        timeoutSeconds: 30,
      });

      // Start reconnect timer
      startDisconnectTimer(io, gameService, gameId, seat);
    });

    // ── Call credentials for this table ──
    // The seat, name, room and permissions are all decided here. A failure
    // returns an error the client can show beside the table; the card game is
    // never interrupted by it.
    socket.on("media:token", async (data) => {
      try {
        const credentials = await media.issueCredentials(
          gameService,
          data?.gameId,
          participantId,
        );
        socket.emit("media:credentials", credentials);
      } catch (err) {
        const failure =
          err instanceof MediaAuthorizationError
            ? err
            : new MediaAuthorizationError(
                "MEDIA_TOKEN_FAILED",
                "Could not start the call. The game is unaffected.",
              );
        socket.emit("media:error", {
          code: failure.code,
          message: failure.message,
        });
      }
    });

    // ── Play a card ──
    socket.on("game:play_card", async (data) => {
      try {
        const { gameId, card } = data;
        const seat = await gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit("game:error", {
            code: "NOT_IN_GAME",
            message: "You are not in this game",
          });
          return;
        }

        const trick = await gameService.playCard(gameId, seat, card);
        const room = await gameService.getRoom(gameId);
        if (!room) return;
        io.to(gameId).emit("game:card_played", {
          seatIndex: seat,
          card,
          nextSeat: room.engine.getState().currentPlayerSeat,
        });
        if (trick) io.to(gameId).emit("game:trick_complete", trick);
        await broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);
      } catch (err: any) {
        socket.emit("game:error", {
          code: "PLAY_FAILED",
          message: err.message,
        });
      }
    });

    // ── Pass cards (Hearts) ──
    socket.on("game:pass_cards", async (data) => {
      try {
        const { gameId, cards } = data;
        const seat = await gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit("game:error", {
            code: "NOT_IN_GAME",
            message: "You are not in this game",
          });
          return;
        }

        await gameService.passCards(gameId, seat, cards);

        // Handle AI passing (they might not have passed yet in this round)
        let phase = await gameService.getPhase(gameId);
        if (phase === GamePhase.Passing) {
          await gameService.executeAITurns(gameId);
          phase = await gameService.getPhase(gameId);
        }

        await broadcastStates(io, gameService, gameId);

        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
        }
      } catch (err: any) {
        socket.emit("game:error", {
          code: "PASS_FAILED",
          message: err.message,
        });
      }
    });

    socket.on("game:deal_next", async ({ gameId, roundNumber }) => {
      try {
        if ((await gameService.getSeatForSocket(gameId, socket.id)) === undefined)
          throw new Error("You are not in this game");
        await gameService.dealNextRound(gameId, roundNumber);
        await broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);
      } catch (err: any) {
        socket.emit("game:error", { code: "DEAL_FAILED", message: err.message });
      }
    });

    socket.on("game:set_auto_deal", async ({ gameId, enabled }) => {
      try {
        if ((await gameService.getSeatForSocket(gameId, socket.id)) === undefined)
          throw new Error("You are not in this game");
        await gameService.setAutoDeal(gameId, enabled);
        await broadcastStates(io, gameService, gameId);
        await handleAITurns(io, gameService, gameId);
      } catch (err: any) {
        socket.emit("game:error", { code: "AUTO_DEAL_FAILED", message: err.message });
      }
    });

    // ── Bid (Spades / Seven-Six) ──
    socket.on("game:bid", async (data) => {
      try {
        const { gameId, bid } = data;
        if (typeof bid !== "number" || !Number.isInteger(bid))
          throw new Error("Choose a whole-number bid.");
        const seat = await gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit("game:error", {
            code: "NOT_IN_GAME",
            message: "You are not in this game",
          });
          return;
        }

        const room = await gameService.getRoom(gameId);
        if (room?.gameType === GameType.SevenSix) {
          await gameService.sevenSixPlaceBid(gameId, seat, bid);
        } else {
          await gameService.placeBid(gameId, seat, bid);
        }
        await broadcastStates(io, gameService, gameId);

        // Handle AI bidding (if more AI need to bid after the human)
        await handleAITurns(io, gameService, gameId);
        await broadcastStates(io, gameService, gameId);

        // If bidding finished and transitioned to playing, handle AI plays
        const phase = await gameService.getPhase(gameId);
        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
        }
      } catch (err: any) {
        socket.emit("game:error", { code: "BID_FAILED", message: err.message });
      }
    });

    // ── Call trump (Euchre) ──
    socket.on("game:call_trump", async (data) => {
      try {
        const { gameId, suit } = data;
        const seat = await gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit("game:error", {
            code: "NOT_IN_GAME",
            message: "You are not in this game",
          });
          return;
        }

        await gameService.callTrump(gameId, seat, suit as any);
        await broadcastStates(io, gameService, gameId);

        // Handle remaining AI trump calls
        await handleAITurns(io, gameService, gameId);
        await broadcastStates(io, gameService, gameId);

        // If trump calling finished and transitioned to playing, handle AI plays
        const phase = await gameService.getPhase(gameId);
        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
        }
      } catch (err: any) {
        socket.emit("game:error", {
          code: "TRUMP_FAILED",
          message: err.message,
        });
      }
    });

    // ── Draw card (Rummy) ──
    socket.on("game:draw_card", async (data) => {
      try {
        const { gameId, source } = data;
        const seat = await gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit("game:error", {
            code: "NOT_IN_GAME",
            message: "You are not in this game",
          });
          return;
        }

        await gameService.rummyDraw(gameId, seat, source);
        await broadcastStates(io, gameService, gameId);
      } catch (err: any) {
        socket.emit("game:error", {
          code: "DRAW_FAILED",
          message: err.message,
        });
      }
    });

    // ── Lay meld (Rummy) ──
    socket.on("game:lay_meld", async (data) => {
      try {
        const { gameId, cards } = data;
        const seat = await gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit("game:error", {
            code: "NOT_IN_GAME",
            message: "You are not in this game",
          });
          return;
        }

        await gameService.rummyLayMeld(gameId, seat, cards);
        await broadcastStates(io, gameService, gameId);

        // If round ended from melding out, check game over
        const phase = await gameService.getPhase(gameId);
        if (phase === GamePhase.GameOver) {
          const room = await gameService.getRoom(gameId);
          if (room) {
            const state = room.engine.getState();
            const winner = room.engine.getWinnerSeat();
            io.to(gameId).emit("game:over", {
              gameId,
              finalScores: state.scores,
              winnerSeat: winner,
            });
          }
          return;
        }

        // If new round started, handle AI turns
        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
          await broadcastStates(io, gameService, gameId);
        }
      } catch (err: any) {
        socket.emit("game:error", {
          code: "MELD_FAILED",
          message: err.message,
        });
      }
    });

    // ── Discard (Rummy) ──
    socket.on("game:discard", async (data) => {
      try {
        const { gameId, card } = data;
        const seat = await gameService.getSeatForSocket(gameId, socket.id);
        if (seat === undefined) {
          socket.emit("game:error", {
            code: "NOT_IN_GAME",
            message: "You are not in this game",
          });
          return;
        }

        await gameService.rummyDiscard(gameId, seat, card);
        await broadcastStates(io, gameService, gameId);

        // Check if round/game ended
        const phase = await gameService.getPhase(gameId);
        if (phase === GamePhase.GameOver) {
          const room = await gameService.getRoom(gameId);
          if (room) {
            const state = room.engine.getState();
            const winner = room.engine.getWinnerSeat();
            io.to(gameId).emit("game:over", {
              gameId,
              finalScores: state.scores,
              winnerSeat: winner,
            });
          }
          return;
        }

        // Handle AI turns
        if (phase === GamePhase.Playing) {
          await handleAITurns(io, gameService, gameId);
          await broadcastStates(io, gameService, gameId);

          // Check again after AI turns
          const newPhase = await gameService.getPhase(gameId);
          if (newPhase === GamePhase.GameOver) {
            const room = await gameService.getRoom(gameId);
            if (room) {
              const state = room.engine.getState();
              const winner = room.engine.getWinnerSeat();
              io.to(gameId).emit("game:over", {
                gameId,
                finalScores: state.scores,
                winnerSeat: winner,
              });
            }
          }
        }
      } catch (err: any) {
        socket.emit("game:error", {
          code: "DISCARD_FAILED",
          message: err.message,
        });
      }
    });

    // ── In-game chat ──
    socket.on("chat:message", async (data) => {
      const { gameId, text } = data;
      const seat = await gameService.getSeatForSocket(gameId, socket.id);
      if (seat === undefined) return;

      io.to(gameId).emit("chat:message", {
        seatIndex: seat,
        displayName,
        text: typeof text === "string" ? text.trim().slice(0, 500) : "",
        timestamp: Date.now(),
      });
    });

    // ── Disconnect ──
    socket.on("disconnect", async () => {
      console.log(`Client disconnected: ${socket.id}`);

      // Clean up presence
      if (userId) {
        const disconnectedUser = await presenceService.setOffline(socket.id);
        if (disconnectedUser) {
          io.emit("presence:update", {
            userId: disconnectedUser,
            online: false,
          });
        }
      }

      // Clean up matchmaking
      await matchmakingService.leaveAllQueues(socket.id);

      // Handle mid-game disconnect — start reconnect timer
      const gameInfo = gameService.findGameBySocket(socket.id);
      if (gameInfo) {
        const { gameId, seat } = gameInfo;
        gameService.handlePlayerDisconnect(gameId, socket.id);

        io.to(gameId).emit("game:player_disconnected", {
          seatIndex: seat,
          timeoutSeconds: 30,
        });

        startDisconnectTimer(io, gameService, gameId, seat);
      }

      const roomId = socket.data.waitingRoomId;
      if (roomId)
        await rooms.queue
          .run(roomId, async () => {
            const room = await rooms.load(roomId);
            const player = room?.players.find((p) => p.socketId === socket.id);
            if (room && player && !room.gameId) {
              player.connected = false;
              player.disconnectedAt = Date.now();
              await rooms.save(room);
              broadcastRoomState(io, room);
              const expiry = setTimeout(() => {
                void rooms.queue
                  .run(roomId, async () => {
                    const latest = await loadRoom(roomId);
                    if (latest && !latest.gameId) {
                      await rooms.save(latest);
                      broadcastRoomState(io, latest);
                    }
                  })
                  .catch(console.error);
              }, 90_010);
              expiry.unref();
            }
          })
          .catch(console.error);
    });
  });
}

function toRoomState(room: FamilyRoom, socketId: string): WaitingRoomState {
  return {
    roomId: room.id,
    gameType: room.gameType,
    host: room.players.find((p) => p.id === room.hostId)?.displayName ?? "Host",
    mySeat: room.players.findIndex((player) => player.socketId === socketId),
    players: room.players.map((p, i) => ({
      displayName: p.displayName,
      avatarUrl: null,
      isHost: p.id === room.hostId,
      connected: p.connected,
      seatIndex: i,
    })),
    maxPlayers: room.maxPlayers,
    fillWithAI: room.players.length < room.maxPlayers,
    config: room.config,
  };
}

function broadcastRoomState(io: GameServer, room: FamilyRoom): void {
  for (const player of room.players) {
    io.to(player.socketId).emit(
      "room:update",
      toRoomState(room, player.socketId),
    );
  }
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

    const room = await gameService.getRoom(gameId);
    if (!room) return;

    const player = room.engine.getState().players[seat];
    if (player.isConnected) return; // They reconnected

    console.log(`Reconnect timeout for seat ${seat} in game ${gameId}`);

    // Notify remaining players — they can choose to continue or quit
    // For now, we emit a special event. The client shows a modal.
    io.to(gameId).emit("game:player_disconnected", {
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
  await gameService.executeAITurns(
    gameId,
    async (seatIndex, card) => {
      const room = gameService.getRoomSync(gameId);
      if (!room) return;
      io.to(gameId).emit("game:card_played", {
        seatIndex,
        card,
        nextSeat: room.engine.getState().currentPlayerSeat,
      });
      if (room.trickReview && room.trickReview.until > Date.now())
        io.to(gameId).emit("game:trick_complete", room.trickReview.trick);
      await broadcastStates(io, gameService, gameId);
    },
    () => broadcastStates(io, gameService, gameId),
  );

  const room = await gameService.getRoom(gameId);
  if (!room) return;

  const state = room.engine.getState();

  if (state.phase === GamePhase.GameOver) {
    await finalizeGame(io, gameService, gameId);
    return;
  }

  await broadcastStates(io, gameService, gameId);
}

async function broadcastStates(
  io: GameServer,
  gameService: GameService,
  gameId: string,
): Promise<void> {
  const room = await gameService.getRoom(gameId);
  if (!room) return;

  for (const [seat, socketId] of room.playerSockets) {
    const state = await gameService.getVisibleState(gameId, seat);
    io.to(socketId).emit("game:state", state);
  }
}

async function finalizeGame(
  io: GameServer,
  service: GameService,
  gameId: string,
) {
  const room = await service.getRoom(gameId);
  if (!room) return;
  await broadcastStates(io, service, gameId);
  let saved = false;
  try {
    await persistenceService.saveCompletedGame(
      gameId,
      room,
      room.engine.getWinnerSeat(),
    );
    saved = true;
  } catch (error) {
    console.error("Result save failed; reconnect can retry", gameId, error);
  }
  io.to(gameId).emit("game:over", {
    gameId,
    finalScores: room.engine.getState().scores,
    winnerSeat: room.engine.getWinnerSeat(),
    saved,
  });
}
