// File-backed storage used by the EC2 deployment. Every write is serialized
// through a queue and goes through a tmp-file rename so the data file is
// never half-written.

import fs from "fs/promises";
import fssync from "fs";
import path from "path";

export function createFileStorage(dataFile) {
  const dir = path.dirname(dataFile);
  if (!fssync.existsSync(dir)) {
    fssync.mkdirSync(dir, { recursive: true });
  }
  if (!fssync.existsSync(dataFile)) {
    fssync.writeFileSync(
      dataFile,
      JSON.stringify({ submissions: [], events: [] }, null, 2),
      "utf-8"
    );
  }

  let writeQueue = Promise.resolve();

  async function readData() {
    const raw = await fs.readFile(dataFile, "utf-8");
    try {
      const parsed = JSON.parse(raw);
      return {
        submissions: Array.isArray(parsed?.submissions)
          ? parsed.submissions
          : [],
        events: Array.isArray(parsed?.events) ? parsed.events : [],
      };
    } catch {
      return { submissions: [], events: [] };
    }
  }

  function writeData(updater) {
    writeQueue = writeQueue.then(async () => {
      const current = await readData();
      const next = await updater(current);
      const tmp = dataFile + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf-8");
      await fs.rename(tmp, dataFile);
      return next;
    });
    return writeQueue;
  }

  return { readData, writeData };
}
