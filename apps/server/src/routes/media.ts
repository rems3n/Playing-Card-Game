import type { FastifyInstance } from "fastify";
import { MediaService } from "../services/MediaService.js";
import { createMediaProvider } from "../services/media/index.js";
import { InviteService } from "../services/InviteService.js";
import { createInviteProvider } from "../services/invite/index.js";
import { env } from "../config/env.js";

/**
 * Tells the web app whether call controls should appear at all. It returns no
 * secrets: credentials are only ever issued over the game socket, to a socket
 * that already holds a seat.
 */
export async function mediaRoutes(
  fastify: FastifyInstance,
  options: { media?: MediaService; invites?: InviteService } = {},
) {
  const media =
    options.media ??
    new MediaService(createMediaProvider(env), env.MEDIA_TOKEN_TTL_SECONDS);
  const invites =
    options.invites ??
    new InviteService(createInviteProvider(env), env.WEB_URL);
  fastify.get("/media/config", async () => media.config());
  // Tells the web app which invitations the server can send itself. The rest
  // are handed to the player's own mail or messaging app.
  fastify.get("/invite/config", async () => invites.config());
}
