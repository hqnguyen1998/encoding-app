const { access, copyFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function prepareWindowsMediaBinaries(root) {
  const ffmpegDestination = path.join(root, 'vendor', 'ffmpeg', 'win-x64', 'ffmpeg.exe');
  const ffprobeDestination = path.join(root, 'vendor', 'ffmpeg', 'win-x64', 'ffprobe.exe');
  if (await exists(ffmpegDestination) && await exists(ffprobeDestination)) return;
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Thiếu FFmpeg Windows x64. Hãy chạy dist:win trên Windows x64.');
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
  if (process.argv[2] !== 'win-x64') throw new Error('Target phải là win-x64.');
  await prepareWindowsMediaBinaries(path.resolve(__dirname, '..'));
  console.log('FFmpeg/FFprobe Windows x64 đã sẵn sàng.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
