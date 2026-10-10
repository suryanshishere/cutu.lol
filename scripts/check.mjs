import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? javascriptFiles(path) : /\.(?:js|mjs)$/.test(path) ? [path] : [];
  }))).flat();
}

for (const path of ["server.mjs", ...(await Promise.all(["site", "src", "scripts", "test"].map(javascriptFiles))).flat()]) {
  const result = spawnSync(process.execPath, ["--check", path], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const result = spawnSync(process.execPath, ["--test"], { stdio: "inherit" });
process.exit(result.status ?? 1);
