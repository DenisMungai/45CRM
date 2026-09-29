import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";
export function serveStatic(app: Express) { const root = path.resolve(process.cwd(), "dist/public"); app.use((req, res, next) => { if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next(); const file = path.join(root, req.path === "/" ? "index.html" : req.path); if (fs.existsSync(file) && fs.statSync(file).isFile()) return res.sendFile(file); return res.sendFile(path.join(root, "index.html")); }); }
