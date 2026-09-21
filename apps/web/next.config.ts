import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  transpilePackages: [
    '@card-game/shared-types',
    '@card-game/shared-socket',
    '@card-game/shared-store',
  ],
};

export default nextConfig;
