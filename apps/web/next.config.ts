import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@card-game/shared-types',
    '@card-game/shared-socket',
    '@card-game/shared-store',
  ],
};

export default nextConfig;
