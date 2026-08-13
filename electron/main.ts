import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  EncodeConfig,
  EncodeEvent,
  EncodeStartResult,
  HardwareAccelerationStatus,
  RcloneRemoteConfig,
  RcloneRemoteConfigResult,
  RcloneTargetConfig,
  RcloneUploadConfig,
  RcloneUploadEvent,
  RcloneUploadStartResult,
  SubtitleExportConfig,
  VideoEncoderId,
} from '../shared/types';
import { getFfmpegPath, getFfprobePath } from './encoder/binaries';
import { safeBaseName } from './encoder/command';
import { EncodeJob } from './encoder/job';
import { inspectHardwareAcceleration, resolveVideoEncoder } from './encoder/hardware';
import { probeMedia } from './encoder/probe';
import { exportSubtitleTracks } from './subtitles/export';
import { getRclonePath } from './rclone/binary';
import { inspectRclone, testRcloneTarget } from './rclone/client';
import { saveRcloneRemote } from './rclone/config';
import { RcloneUploadJob } from './rclone/upload';
import { normalizePublicBaseUrl } from '../shared/public-url';

let mainWindow: BrowserWindow | null = null;
let activeJob: EncodeJob | null = null;
let activeUploadJob: RcloneUploadJob | null = null;
let subtitleExportActive = false;
let hardwareAccelerationPromise: Promise<HardwareAccelerationStatus> | null = null;

function getHardwareAccelerationStatus(): Promise<HardwareAccelerationStatus> {
  hardwareAccelerationPromise ??= inspectHardwareAcceleration(getFfmpegPath());
  return hardwareAccelerationPromise;
}

async function createUniqueOutputPath(root: string, inputName: string): Promise<string> {
  const base = `${safeBaseName(inputName)}-hls`;
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = path.join(root, suffix === 0 ? base : `${base}-${suffix + 1}`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Không thể tạo tên thư mục đầu ra duy nhất.');
}

function sendEncodeEvent(event: EncodeEvent): void {
  if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
    if (activeJob?.id === event.jobId) activeJob = null;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('encode:event', event);
}

function sendRcloneUploadEvent(event: RcloneUploadEvent): void {
  if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
    if (activeUploadJob?.id === event.jobId) activeUploadJob = null;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('rclone-upload:event', event);
}

function assertRcloneTargetConfig(config: unknown): asserts config is RcloneTargetConfig {
  if (!config || typeof config !== 'object') throw new Error('Cấu hình Rclone không hợp lệ.');
  const candidate = config as Record<string, unknown>;
  if (
    typeof candidate.remoteName !== 'string' ||
    candidate.remoteName.length === 0 ||
    candidate.remoteName.length > 64 ||
    typeof candidate.destinationPath !== 'string' ||
    candidate.destinationPath.length > 1_000
  ) {
    throw new Error('Remote hoặc đường dẫn đích Rclone không hợp lệ.');
  }
  if (candidate.publicBaseUrl !== undefined) {
    if (typeof candidate.publicBaseUrl !== 'string' || candidate.publicBaseUrl.length > 2_000) {
      throw new Error('URL public không hợp lệ.');
    }
    normalizePublicBaseUrl(candidate.publicBaseUrl);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 790,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0b0d10',
    title: 'Đảo Phim Encoding',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('dialog:select-input', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Chọn video nguồn',
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'mts'] },
        { name: 'Tất cả tệp', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-inputs', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Thêm video vào hàng đợi encode',
      buttonLabel: 'Thêm vào queue',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'mts'] },
        { name: 'Tất cả tệp', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:select-output', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Chọn thư mục xuất HLS',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-subtitle-output', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Chọn thư mục xuất subtitle',
      buttonLabel: 'Xuất vào đây',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-hls-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Chọn thư mục HLS local',
      buttonLabel: 'Chọn thư mục HLS',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-hls-folders', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Thêm thư mục HLS vào hàng đợi upload',
      buttonLabel: 'Thêm vào queue',
      properties: ['openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:select-logo', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Chọn ảnh logo đóng vào video',
      buttonLabel: 'Chọn logo',
      properties: ['openFile'],
      filters: [
        { name: 'Ảnh logo', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('media:probe', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('Đường dẫn video không hợp lệ.');
    return probeMedia(getFfprobePath(), filePath);
  });

  ipcMain.handle('encoder:hardware-status', () => getHardwareAccelerationStatus());

  ipcMain.handle('subtitle:export', async (_event, config: SubtitleExportConfig) => {
    if (activeJob) throw new Error('Hãy đợi tác vụ encode hoàn tất trước khi xuất subtitle.');
    if (subtitleExportActive) throw new Error('Một tác vụ xuất subtitle khác đang chạy.');
    if (
      !config ||
      typeof config.inputPath !== 'string' ||
      typeof config.outputDirectory !== 'string' ||
      !Array.isArray(config.streamIndices) ||
      config.streamIndices.length === 0 ||
      config.streamIndices.length > 100 ||
      !config.streamIndices.every((index) => Number.isInteger(index) && index >= 0)
    ) {
      throw new Error('Cấu hình xuất subtitle không hợp lệ.');
    }

    subtitleExportActive = true;
    try {
      const media = await probeMedia(getFfprobePath(), config.inputPath);
      return await exportSubtitleTracks(getFfmpegPath(), config, media.subtitleTracks);
    } finally {
      subtitleExportActive = false;
    }
  });

  ipcMain.handle('encode:start', async (_event, config: EncodeConfig): Promise<EncodeStartResult> => {
    if (activeJob) throw new Error('Một tác vụ encode khác đang chạy.');
    if (activeUploadJob) throw new Error('Hãy đợi upload R2/S3 hoàn tất trước khi encode.');
    if (subtitleExportActive) throw new Error('Hãy đợi tác vụ xuất subtitle hoàn tất trước khi encode.');
    if (!config || typeof config.inputPath !== 'string' || typeof config.outputDirectory !== 'string') {
      throw new Error('Cấu hình encode không hợp lệ.');
    }
    const allowedEncoders: VideoEncoderId[] = ['auto', 'libx264', 'h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf'];
    if (config.videoEncoderId && !allowedEncoders.includes(config.videoEncoderId)) {
      throw new Error('Bộ mã hóa video không hợp lệ.');
    }
    if (config.advanced != null && (typeof config.advanced !== 'object' || Array.isArray(config.advanced))) {
      throw new Error('Cấu hình encode nâng cao không hợp lệ.');
    }
    if (config.logoOverlay != null && (typeof config.logoOverlay !== 'object' || Array.isArray(config.logoOverlay))) {
      throw new Error('Cấu hình đóng logo không hợp lệ.');
    }
    if (config.logoOverlay?.enabled) {
      if (typeof config.logoOverlay.path !== 'string' || !config.logoOverlay.path || config.logoOverlay.path.length > 4_000) {
        throw new Error('Đường dẫn ảnh logo không hợp lệ.');
      }
      if (!/\.(png|jpe?g|webp|bmp)$/i.test(config.logoOverlay.path)) {
        throw new Error('Logo phải là file PNG, JPG, WebP hoặc BMP.');
      }
      try {
        await access(config.logoOverlay.path);
      } catch {
        throw new Error('Không tìm thấy file logo đã chọn. Hãy chọn lại ảnh logo.');
      }
    }

    await mkdir(config.outputDirectory, { recursive: true });
    const media = await probeMedia(getFfprobePath(), config.inputPath);
    const encoder = config.presetId === 'copy-source'
      ? { id: 'libx264' as const, label: 'Stream Copy · không encode video', hardware: false }
      : resolveVideoEncoder(config.videoEncoderId, await getHardwareAccelerationStatus());
    const resolvedConfig: EncodeConfig = { ...config, videoEncoderId: encoder.id };
    const outputPath = await createUniqueOutputPath(config.outputDirectory, media.name);
    const job = new EncodeJob(
      getFfmpegPath(),
      resolvedConfig,
      media,
      outputPath,
      sendEncodeEvent,
      encoder.id,
      encoder.label,
    );
    activeJob = job;

    try {
      await job.start();
    } catch (error) {
      activeJob = null;
      throw error;
    }

    return {
      jobId: job.id,
      outputPath,
      videoEncoderId: encoder.id,
      videoEncoderLabel: encoder.label,
    };
  });

  ipcMain.handle('encode:cancel', (_event, jobId: unknown) => {
    if (typeof jobId !== 'string' || activeJob?.id !== jobId) return false;
    return activeJob.cancel();
  });

  ipcMain.handle('rclone:status', () => inspectRclone());

  ipcMain.handle('rclone:save-remote', async (_event, config: RcloneRemoteConfig): Promise<RcloneRemoteConfigResult> => {
    if (activeUploadJob) throw new Error('Hãy đợi upload hoàn tất trước khi thay đổi cấu hình rclone.');
    return saveRcloneRemote(config);
  });

  ipcMain.handle('rclone:test-target', async (_event, config: unknown) => {
    assertRcloneTargetConfig(config);
    return testRcloneTarget(config);
  });

  ipcMain.handle('rclone:upload', async (_event, config: unknown): Promise<RcloneUploadStartResult> => {
    assertRcloneTargetConfig(config);
    const candidate = config as RcloneUploadConfig;
    if (typeof candidate.sourcePath !== 'string' || !candidate.sourcePath || candidate.sourcePath.length > 4_000) {
      throw new Error('Thư mục nguồn upload không hợp lệ.');
    }
    if (
      candidate.performanceId !== undefined &&
      !['stable', 'fast', 'maximum'].includes(candidate.performanceId)
    ) {
      throw new Error('Cấu hình tốc độ upload không hợp lệ.');
    }
    if (activeJob) throw new Error('Hãy đợi encode hoàn tất trước khi upload.');
    if (subtitleExportActive) throw new Error('Hãy đợi xuất subtitle hoàn tất trước khi upload.');
    if (activeUploadJob) throw new Error('Một tác vụ upload khác đang chạy.');

    const rcloneStatus = await inspectRclone();
    if (!rcloneStatus.available) throw new Error(rcloneStatus.message);
    if (!rcloneStatus.remotes.some((remote) => remote.name === candidate.remoteName)) {
      throw new Error('Remote rclone đã chọn không còn tồn tại.');
    }
    const rclonePath = await getRclonePath();
    if (!rclonePath) throw new Error('Không tìm thấy rclone.');

    const job = new RcloneUploadJob(rclonePath, candidate, sendRcloneUploadEvent);
    activeUploadJob = job;
    try {
      await job.start();
    } catch (error) {
      activeUploadJob = null;
      throw error;
    }
    return { jobId: job.id, destination: job.destination };
  });

  ipcMain.handle('rclone:cancel-upload', (_event, jobId: unknown) => {
    if (typeof jobId !== 'string' || activeUploadJob?.id !== jobId) return false;
    return activeUploadJob.cancel();
  });

  ipcMain.handle('shell:reveal', async (_event, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !targetPath) return;
    shell.showItemInFolder(targetPath);
  });

  ipcMain.handle('clipboard:write-text', (_event, text: unknown) => {
    if (typeof text !== 'string' || !text || text.length > 10_000) throw new Error('Nội dung sao chép không hợp lệ.');
    clipboard.writeText(text);
  });

  ipcMain.handle('shell:open-external', async (_event, value: unknown) => {
    if (typeof value !== 'string' || value.length > 2_000) throw new Error('URL không hợp lệ.');
    const url = normalizePublicBaseUrl(value);
    if (!url) throw new Error('URL không hợp lệ.');
    await shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  activeJob?.cancel();
  activeUploadJob?.cancel();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
