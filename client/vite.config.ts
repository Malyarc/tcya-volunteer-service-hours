import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the Vite dev server runs on 5173 and the API on 4000.
// We proxy /api so the React app can use relative URLs in both dev and prod.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
