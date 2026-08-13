const { createHash } = require('node:crypto');
const { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RCLONE_VERSION = '1.75.0';
const TARGETS = {
  'mac-arm64': {
    hostPlatform: 'darwin',
    hostArch: 'arm64',
    archivePlatform: 'osx-arm64',
    archiveSha256: '35e8f2a666ce789b29111db0dd843ddabc0d59c6b609d07bcaae5d1a07cba6f8',
    binaryName: 'rclone',
  },
  'win-x64': {
    hostPlatform: 'win32',
    hostArch: 'x64',
    archivePlatform: 'windows-amd64',
    archiveSha256: '203581f0a7baeae873f2347483a798c79e2eaf5c384a4e9d866aa374f1c89ac0',
    binaryName: 'rclone.exe',
  },
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination, expectedSha256) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Không thể tải ${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== expectedSha256) {
    throw new Error(`Checksum không khớp cho ${path.basename(destination)}.`);
  }
  await writeFile(destination, bytes);
}

function extractZip(archivePath, outputDirectory) {
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
      archivePath, outputDirectory,
    ], { stdio: 'inherit' })
    : spawnSync('/usr/bin/unzip', ['-q', archivePath, '-d', outputDirectory], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Không thể giải nén rclone.');
}

async function prepareRclone(root, targetName, target) {
  const destination = path.join(root, 'vendor', 'rclone', targetName, target.binaryName);
  if (await exists(destination)) return;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'dao-phim-rclone-'));
  try {
    const archiveName = `rclone-v${RCLONE_VERSION}-${target.archivePlatform}.zip`;
    const archivePath = path.join(temporaryDirectory, archiveName);
    const extractDirectory = path.join(temporaryDirectory, 'extract');
    await mkdir(extractDirectory, { recursive: true });
    await download(
      `https://downloads.rclone.org/v${RCLONE_VERSION}/${archiveName}`,
      archivePath,
      target.archiveSha256,
    );
    extractZip(archivePath, extractDirectory);
    const source = path.join(
      extractDirectory,
      `rclone-v${RCLONE_VERSION}-${target.archivePlatform}`,
      target.binaryName,
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    if (targetName === 'mac-arm64') await chmod(destination, 0o755);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function prepareWindowsMediaBinaries(root) {
  const ffmpegDestination = path.join(root, 'vendor', 'ffmpeg', 'win-x64', 'ffmpeg.exe');
  const ffprobeDestination = path.join(root, 'vendor', 'ffmpeg', 'win-x64', 'ffprobe.exe');
  if (await exists(ffmpegDestination) && await exists(ffprobeDestination)) return;
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Thiếu FFmpeg Windows x64. Hãy chạy dist:win trên Windows x64 hoặc đặt binary đúng vào vendor/ffmpeg/win-x64.');
  }
  const ffmpegSource = require('ffmpeg-static');
  const ffprobeSource = require('@ffprobe-installer/ffprobe').path;
  if (!ffmpegSource || !(await exists(ffmpegSource)) || !(await exists(ffprobeSource))) {
    throw new Error('Không tìm thấy FFmpeg/FFprobe Windows từ node_modules. Hãy chạy npm ci trước.');
  }
  await mkdir(path.dirname(ffmpegDestination), { recursive: true });
  await copyFile(ffmpegSource, ffmpegDestination);
  await copyFile(ffprobeSource, ffprobeDestination);
}

async function main() {
  const targetName = process.argv[2];
  const target = TARGETS[targetName];
  if (!target) throw new Error('Target phải là mac-arm64 hoặc win-x64.');
  const root = path.resolve(__dirname, '..');
  if (targetName === 'win-x64') await prepareWindowsMediaBinaries(root);
  await prepareRclone(root, targetName, target);
  const rclonePath = path.join(root, 'vendor', 'rclone', targetName, target.binaryName);
  const binary = await readFile(rclonePath);
  if (binary.length === 0) throw new Error('Rclone đã chuẩn bị nhưng file rỗng.');
  console.log(`Vendor ${targetName} đã sẵn sàng.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
