import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // Self-contained server bundle for the Docker/Coolify deploy —
  // .next/standalone runs with `node server.js`, no node_modules install.
  output: "standalone",
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {key:'X-Content-Type-Options',value:'nosniff'},
          {key:'X-Frame-Options',value:'DENY'},
          {key:'Referrer-Policy',value:'no-referrer'},
          {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},
          {key:'X-XSS-Protection',value:'0'},
          ...(process.env.NODE_ENV === 'production' ? [{key:'Strict-Transport-Security',value:'max-age=31536000'}] : []),
        ],
      },
      {source:'/api/:path*',headers:[{key:'Cache-Control',value:'private, no-store'}]},
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
