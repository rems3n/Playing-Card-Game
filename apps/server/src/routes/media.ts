import type { FastifyInstance } from "fastify";
import { MediaService } from "../services/MediaService.js";
import { createMediaProvider } from "../services/media/index.js";
import { env } from "../config/env.js";

/**
 * Tells the web app whether call controls should appear at all. It returns no
 * secrets: credentials are only ever issued over the game socket, to a socket
 * that already holds a seat.
 */
export async function mediaRoutes(
  fastify: FastifyInstance,
  options: { media?: MediaService } = {},
) {
  const media =
    options.media ??
    new MediaService(createMediaProvider(env), env.MEDIA_TOKEN_TTL_SECONDS);
  fastify.get("/media/config", async () => media.config());
}
