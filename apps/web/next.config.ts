import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { readFileSync } from "fs";
import { join } from "path";

const withNextIntl = createNextIntlPlugin();

// Read version from root package.json
const rootPkg = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8"),
);

// API URL configuration
// - For local dev (default): http://localhost:3001
// - For Docker/custom: set API_URL env variable
// - Can use absolute URL (with protocol) or relative path
const apiUrl = process.env.API_URL || "http://localhost:3001";
const API_DESTINATION = apiUrl.endsWith('/api')
  ? `${apiUrl}/:path*` 
  : `${apiUrl}/api/:path*`;

// Base Next.js config
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: join(__dirname, '../..'),
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPkg.version || "0.0.0",
    // NOTE: NEXT_PUBLIC_WS_PORT is a build-time variable baked into the JS bundle.
    // At runtime (e.g. Docker), use WS_EXTERNAL_PORT env var instead — it is written
    // into runtime-config.js by docker-start.sh and read via window.__RUNTIME_CONFIG__.
    NEXT_PUBLIC_WS_PORT: process.env.NEXT_PUBLIC_WS_PORT || "3002",
    NEXT_PUBLIC_GITHUB_REPO:
      process.env.NEXT_PUBLIC_GITHUB_REPO || "WhiteBalance2800K/neko-master",
  },
  // Turbopack configuration (formerly experimental.turbopack)
  turbopack: {
    // Enable filesystem caching for faster rebuilds
    resolveAlias: {
      // Handle any Node.js native module imports in client code
    },
  },
  async rewrites() {
    return [
      {
        source: "/manifest.json",
        destination: "/manifest.webmanifest",
      },
      {
        source: "/api/:path*",
        destination: API_DESTINATION,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ];
  },
};

// Apply PWA in production only
// Note: PWA plugin uses webpack, so we need to use --webpack flag for production builds
let finalConfig = withNextIntl(nextConfig);

if (process.env.NODE_ENV === "production") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const withPWA = require("@ducanh2912/next-pwa");
    finalConfig = withPWA({
      dest: "public",
      register: true,
      skipWaiting: true,
      disable: false,
      buildExcludes: [/middleware-manifest.json$/],
    })(finalConfig);
  } catch {
    // PWA not available, use base config
  }
}

export default finalConfig;
