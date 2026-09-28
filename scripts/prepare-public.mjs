import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const destination = join(root, "public");
const files = ["index.html", "styles.css", "app.js", "hamster-transparent.webm"];

await mkdir(destination, { recursive: true });
await Promise.all(files.map((file) => copyFile(join(root, file), join(destination, file))));
console.log(`Prepared ${files.length} public assets.`);
