import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-native tooling that Turbopack chokes on trying to bundle into the
  // route-handler graph (esbuild binaries, non-JS asset files pulled in
  // transitively) — use native `require` instead. Hit this concretely
  // while wiring up the real Remotion render job.
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer", "@electric-sql/pglite"],
   allowedDevOrigins: [
    'liver-effective-conservation-camp.trycloudflare.com',
  ],
};

export default nextConfig;
