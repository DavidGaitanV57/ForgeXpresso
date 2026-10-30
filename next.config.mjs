/** @type {import('next').NextConfig} */
const cors = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
];

const nextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ["sharp"],
  devIndicators: false,
  // The studio moved from / to /studio; keep old shared project links working.
  async redirects() {
    return [{ source: "/", has: [{ type: "query", key: "p" }], destination: "/studio", permanent: false }];
  },
  // Games run in a sandboxed iframe with an opaque origin, so the engine and runtime files need CORS.
  async headers() {
    return [
      { source: "/runtime/:path*", headers: cors },
      { source: "/vendor/:path*", headers: [...cors, { key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default nextConfig;
