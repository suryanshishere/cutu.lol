import { cp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPageMeta } from "../src/page-meta.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "site");
const destination = join(root, "public");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
const index = join(destination, "index.html");
await writeFile(index, applyPageMeta(await readFile(index, "utf8"), new URL("https://cutu.suryansh.lol/")));
console.log("Prepared public assets from site/.");
