import { copyFile, mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonWithRecovery(filePath, fallbackFactory) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallbackFactory();
    const corruptPath = `${filePath}.corrupt-${timestamp()}`;
    await copyFile(filePath, corruptPath).catch(() => null);
    const backupPath = `${filePath}.bak`;
    if (await exists(backupPath)) {
      try {
        return JSON.parse(await readFile(backupPath, 'utf8'));
      } catch {}
    }
    throw new Error(`JSON data is corrupt. A copy was preserved at ${corruptPath}.`);
  }
}

export async function atomicWriteJson(filePath, value, { mode = 0o600 } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  if (await exists(filePath)) await copyFile(filePath, `${filePath}.bak`).catch(() => null);
  const handle = await open(temporaryPath, 'w', mode);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

export function createSerialJsonWriter(filePath, options = {}) {
  let queue = Promise.resolve();
  return (value) => {
    const operation = queue.then(() => atomicWriteJson(filePath, value, options));
    queue = operation.catch(() => null);
    return operation;
  };
}
