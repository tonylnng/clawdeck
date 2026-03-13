/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // NOTE: Do NOT use rewrites() for /api/* — rewrites are build-time and cannot
  // use runtime env vars. The [...proxy] route handler reads BACKEND_INTERNAL_URL
  // at request time, which correctly supports Docker bridge networking.
};

module.exports = nextConfig;
