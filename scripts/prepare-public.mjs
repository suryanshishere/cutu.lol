import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const source = join(root, "site");
const destination = join(root, "public");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log("Prepared public assets from site/.");
