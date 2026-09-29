import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({ plugins: [react(), tailwindcss()], resolve: { alias: { "@": path.resolve(import.meta.dirname, "client", "src"), "@shared": path.resolve(import.meta.dirname, "shared"), "@assets": path.resolve(import.meta.dirname, "attached_assets") } }, envDir: path.resolve(import.meta.dirname), root: path.resolve(import.meta.dirname, "client"), publicDir: path.resolve(import.meta.dirname, "client/public"), build: { outDir: path.resolve(import.meta.dirname, "dist/public"), emptyOutDir: true, rollupOptions: { output: { manualChunks: { charts: ["recharts"], motion: ["framer-motion"] } } } }, server: { host: true, port: 5173, proxy: { "/api": "http://localhost:3000", "/uploads": "http://localhost:3000" } } });
