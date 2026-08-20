import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /chat, /reserve, /health to the Express API (npm start
// in the project root, port 3000) so the client never hardcodes a backend
// origin - `fetch("/chat")` works identically in dev and in the built
// static bundle Express serves in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/chat": "http://localhost:3000",
      "/reserve": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
