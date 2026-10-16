import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@google-github-sync/shared'],
  logging: {
    browserToTerminal: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '**.google.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
  },
};

export default nextConfig;
