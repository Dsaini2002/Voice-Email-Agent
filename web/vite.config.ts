import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The dashboard and API share one origin in dev, so the login cookie just works.
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
});
