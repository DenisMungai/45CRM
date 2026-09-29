import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const uploadRoot = path.resolve(process.cwd(), "uploads");
export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream") {
  const ext = path.extname(relKey);
  const safeName = `${path.basename(relKey, ext)}_${randomUUID().slice(0, 8)}${ext}`;
  const relative = path.join(path.dirname(relKey), safeName);
  const target = path.join(uploadRoot, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, typeof data === "string" ? Buffer.from(data) : data);
  return { key: relative.replaceAll(path.sep, "/"), url: `/uploads/${relative.replaceAll(path.sep, "/")}`, contentType };
}
