import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local dev you normally run the whole thing via the Static Web Apps CLI
// (`swa start`), which proxies /api and /.auth for you. The proxy below is a
// convenience for running `vite` directly against a local `func start` on 7071.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/api": "http://localhost:7071",
    },
  },
});
