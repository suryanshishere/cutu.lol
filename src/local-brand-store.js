import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

export function createLocalBrandStore(path) {
  async function read() { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return {}; throw error; } }
  async function save(data) { await mkdir(dirname(path), { recursive: true }); await writeFile(`${path}.tmp`, JSON.stringify(data)); await rename(`${path}.tmp`, path); }
  return {
    async get(key) { return (await read())[key]; },
    async put(key, value) { const data = await read(); data[key] = value; await save(data); },
    async delete(key) { const data = await read(); delete data[key]; await save(data); },
    async list({ prefix }) { return new Map(Object.entries(await read()).filter(([key]) => key.startsWith(prefix))); }
  };
}
