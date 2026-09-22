import {
  MEDIA_ERROR_CODES,
  type MediaConfig,
  type MediaCredentials,
} from "@card-game/shared-types";
import type { GameService } from "./GameService.js";
import type { MediaProvider } from "./media/MediaProvider.js";

export class MediaAuthorizationError extends Error {
  constructor(
    readonly code: (typeof MEDIA_ERROR_CODES)[keyof typeof MEDIA_ERROR_CODES],
    message: string,
  ) {
    super(message);
  }
}

/** Long enough to join and reconnect once, short enough to be worth little. */
export const DEFAULT_MEDIA_TTL_SECONDS = 300;

/** A room name a client cannot forge into someone else's table. */
export function mediaRoomName(gameId: string): string {
  return `table-${gameId}`;
}

/**
 * Issues call credentials for a table.
 *
 * The caller supplies a game id and nothing else. The seat, the display name,
 * the room and the permissions all come from server state, so a client cannot
 * ask for a seat it does not hold, a name it does not own, or a room it is not
 * at. Credentials are refused outright for anyone without a seat.
 */
export class MediaService {
  constructor(
    private provider: MediaProvider,
    private ttlSeconds: number = DEFAULT_MEDIA_TTL_SECONDS,
  ) {}

  config(): MediaConfig {
    return { enabled: this.provider.enabled, provider: this.provider.name };
  }

  async issueCredentials(
    games: GameService,
    gameId: unknown,
    participantId: string,
  ): Promise<MediaCredentials> {
    if (!this.provider.enabled)
      throw new MediaAuthorizationError(
        MEDIA_ERROR_CODES.disabled,
        "Live audio and video are not available on this server",
      );
    if (typeof gameId !== "string" || !gameId)
      throw new MediaAuthorizationError(
        MEDIA_ERROR_CODES.notSeated,
        "You are not at this table",
      );

    const room = await games.getRoom(gameId);
    if (!room)
      throw new MediaAuthorizationError(
        MEDIA_ERROR_CODES.notSeated,
        "You are not at this table",
      );

    // The seat comes from the server's participant map, never from the client.
    let seatIndex = -1;
    for (const [seat, id] of room.participants)
      if (id === participantId) seatIndex = seat;
    const player = room.engine.getState().players[seatIndex];
    if (seatIndex < 0 || !player || player.isAI)
      throw new MediaAuthorizationError(
        MEDIA_ERROR_CODES.notSeated,
        "You are not at this table",
      );

    const roomName = mediaRoomName(gameId);
    // Identity is unique inside the room and says nothing about the account.
    const identity = `seat-${seatIndex}`;
    try {
      const issued = await this.provider.issueToken({
        roomName,
        identity,
        displayName: player.displayName,
        ttlSeconds: this.ttlSeconds,
      });
      return {
        provider: this.provider.name,
        url: issued.url,
        token: issued.token,
        roomName,
        identity,
        displayName: player.displayName,
        seatIndex,
        expiresAt: issued.expiresAt,
      };
    } catch (error) {
      throw new MediaAuthorizationError(
        MEDIA_ERROR_CODES.failed,
        error instanceof Error
          ? error.message
          : "Could not start the call. The game is unaffected.",
      );
    }
  }
}
