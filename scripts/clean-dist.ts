import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

if (dirname(dist) !== root || basename(dist) !== "dist") {
  throw new Error(`Refusing to clean unexpected output directory: ${dist}`);
}

await rm(dist, { recursive: true, force: true });
