// Inject the global upload size cap from a single source of truth so
// the frontend display matches what the API will actually accept.
// Falls back to the shared default (250 MB) if the env var isn't set.
const DEFAULT_MAX_FILE_SIZE_MB = 250;
const maxFileSizeMB = process.env.MAX_FILE_SIZE_MB ?? String(DEFAULT_MAX_FILE_SIZE_MB);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_MAX_FILE_SIZE_MB: maxFileSizeMB,
  },
};

module.exports = nextConfig;
