import { vlyPlugin } from "@vly-ai/integrations";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Dev-only Vite config so the dashboard can be previewed from the repo root.
// The VPS serves the built dashboard from web/dist through the Node server,
// so this file is only used by local development / preview tooling.
export default defineConfig({
  root: "web",
  plugins: [vlyPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
    // Keep a single copy of React across all packages.
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  },
  server: {
    host: true,
    port: 5173,
    hmr: false,
  },
});
