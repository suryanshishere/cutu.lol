import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createLocalEmailStore(filePath) {
  let pending = Promise.resolve();
  return (email) => {
    const operation = pending.then(async () => {
      let entries;
      try {
        entries = JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        entries = [];
      }
      if (!Array.isArray(entries)) throw new Error("Invalid local email store");
      if (entries.some((entry) => entry.email === email)) return;
      entries.push({ email, createdAt: new Date().toISOString() });
      await mkdir(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(entries, null, 2), { mode: 0o600 });
      await rename(temporaryPath, filePath);
    });
    pending = operation.catch(() => {});
    return operation;
  };
}
