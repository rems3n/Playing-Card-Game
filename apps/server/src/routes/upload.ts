import { requireAuth } from "../middleware/auth.js";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, unlink } from "fs/promises";
import { pipeline } from "stream/promises";
import path from "path";

const UPLOADS_DIR = path.resolve("uploads/avatars");
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  // Ensure uploads directory exists
  await mkdir(UPLOADS_DIR, { recursive: true });

  /**
   * POST /api/upload/avatar
   * Upload an avatar image. Returns the URL to the uploaded file.
   */
  fastify.post(
    "/api/upload/avatar",
    { preHandler: requireAuth },
    async (request, reply) => {
      const file = await request.file();

      if (!file) {
        reply.status(400);
        return { success: false, error: "No file uploaded" };
      }

      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        reply.status(400);
        return {
          success: false,
          error: "Only JPEG, PNG, WebP, and GIF images are allowed",
        };
      }

      const ext = file.mimetype.split("/")[1].replace("jpeg", "jpg");
      const filename = `${randomUUID()}.${ext}`;
      const filepath = path.join(UPLOADS_DIR, filename);

      try {
        await pipeline(file.file, createWriteStream(filepath));
        if (file.file.truncated) {
          await unlink(filepath).catch(() => {});
          return reply
            .code(413)
            .send({
              success: false,
              error: "File too large. Maximum size is 5MB.",
            });
        }
      } catch (error) {
        await unlink(filepath).catch(() => {});
        throw error;
      }

      const url = `/uploads/avatars/${filename}`;
      return { success: true, url };
    },
  );
}
