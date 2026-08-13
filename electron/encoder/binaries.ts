import { app } from 'electron';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

interface FfprobeInstaller {
  path: string;
}

function unpackedPath(binaryPath: string): string {
  return binaryPath.replace('app.asar', 'app.asar.unpacked');
}

export function getFfmpegPath(): string {
  if (app.isPackaged && process.platform === 'win32') {
    return path.join(process.resourcesPath, 'bin', 'ffmpeg.exe');
  }
  if (!ffmpegStatic) {
    throw new Error('Không tìm thấy FFmpeg được đóng gói cùng ứng dụng.');
  }

  return unpackedPath(ffmpegStatic);
}

export function getFfprobePath(): string {
  if (app.isPackaged && process.platform === 'win32') {
    return path.join(process.resourcesPath, 'bin', 'ffprobe.exe');
  }
  // Chỉ nạp installer của nền tảng đang chạy. Cross-build Windows trên macOS
  // dùng binary trong resources/bin và không được require gói darwin ở Windows.
  const ffprobeInstaller = require('@ffprobe-installer/ffprobe') as FfprobeInstaller;
  return unpackedPath(ffprobeInstaller.path);
}
