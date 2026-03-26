import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { pipeline } from 'stream/promises';
import path from 'path';

const UPLOADS_DIR = path.resolve('uploads/avatars');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  // Ensure uploads directory exists
  await mkdir(UPLOADS_DIR, { recursive: true });

  /**
   * POST /api/upload/avatar
   * Upload an avatar image. Returns the URL to the uploaded file.
   */
  // TODO: Add auth once token flow is fully wired (requireAuth preHandler)
  fastify.post('/api/upload/avatar', async (request, reply) => {
    const file = await request.file();

    if (!file) {
      reply.status(400);
      return { success: false, error: 'No file uploaded' };
    }

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      reply.status(400);
      return { success: false, error: 'Only JPEG, PNG, WebP, and GIF images are allowed' };
    }

    const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg');
    const filename = `${randomUUID()}.${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);

    // Stream file to disk
    const writeStream = createWriteStream(filepath);
    let size = 0;

    try {
      for await (const chunk of file.file) {
        size += chunk.length;
        if (size > MAX_FILE_SIZE) {
          writeStream.destroy();
          reply.status(400);
          return { success: false, error: 'File too large. Maximum size is 5MB.' };
        }
        writeStream.write(chunk);
      }
      writeStream.end();

      // Wait for write to finish
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } catch (err) {
      writeStream.destroy();
      throw err;
    }

    const url = `/uploads/avatars/${filename}`;
    return { success: true, url };
  });
}
