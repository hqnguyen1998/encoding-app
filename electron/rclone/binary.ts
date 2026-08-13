import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

function platformFolder(): string | null {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
  if (process.platform === 'win32' && process.arch === 'x64') return 'win-x64';
  return null;
}

function binaryName(): string {
  return process.platform === 'win32' ? 'rclone.exe' : 'rclone';
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getRclonePath(): Promise<string | null> {
  const folder = platformFolder();
  const name = binaryName();
  const candidates: string[] = [];

  if (process.env.RCLONE_PATH) candidates.push(process.env.RCLONE_PATH);
  if (folder) {
    if (typeof process.resourcesPath === 'string') {
      candidates.push(path.join(process.resourcesPath, 'bin', name));
    }
    candidates.push(path.resolve(__dirname, '../../../vendor/rclone', folder, name));
  }

  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  candidates.push(...pathEntries.map((entry) => path.join(entry, name)));
  if (process.platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/rclone', '/usr/local/bin/rclone', '/usr/bin/rclone');
  }

  for (const candidate of [...new Set(candidates)]) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}
