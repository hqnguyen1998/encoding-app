import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  EncodeConfig,
  EncodeEvent,
  EncodeStartResult,
  EncoderApi,
  HardwareAccelerationStatus,
  MediaInfo,
  RcloneRemoteConfig,
  RcloneRemoteConfigResult,
  RcloneStatus,
  RcloneTargetConfig,
  RcloneTargetResult,
  RcloneUploadConfig,
  RcloneUploadEvent,
  RcloneUploadStartResult,
  SubtitleExportConfig,
  SubtitleExportResult,
} from '../shared/types';

const api: EncoderApi = {
  selectInput: () => ipcRenderer.invoke('dialog:select-input') as Promise<string | null>,
  selectInputs: () => ipcRenderer.invoke('dialog:select-inputs') as Promise<string[]>,
  selectOutput: () => ipcRenderer.invoke('dialog:select-output') as Promise<string | null>,
  selectSubtitleOutput: () => ipcRenderer.invoke('dialog:select-subtitle-output') as Promise<string | null>,
  selectHlsFolder: () => ipcRenderer.invoke('dialog:select-hls-folder') as Promise<string | null>,
  selectHlsFolders: () => ipcRenderer.invoke('dialog:select-hls-folders') as Promise<string[]>,
  selectLogo: () => ipcRenderer.invoke('dialog:select-logo') as Promise<string | null>,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  probeMedia: (filePath: string) => ipcRenderer.invoke('media:probe', filePath) as Promise<MediaInfo>,
  getHardwareAccelerationStatus: () =>
    ipcRenderer.invoke('encoder:hardware-status') as Promise<HardwareAccelerationStatus>,
  exportSubtitles: (config: SubtitleExportConfig) =>
    ipcRenderer.invoke('subtitle:export', config) as Promise<SubtitleExportResult>,
  startEncode: (config: EncodeConfig) =>
    ipcRenderer.invoke('encode:start', config) as Promise<EncodeStartResult>,
  cancelEncode: (jobId: string) => ipcRenderer.invoke('encode:cancel', jobId) as Promise<boolean>,
  getRcloneStatus: () => ipcRenderer.invoke('rclone:status') as Promise<RcloneStatus>,
  saveRcloneRemote: (config: RcloneRemoteConfig) =>
    ipcRenderer.invoke('rclone:save-remote', config) as Promise<RcloneRemoteConfigResult>,
  testRcloneTarget: (config: RcloneTargetConfig) =>
    ipcRenderer.invoke('rclone:test-target', config) as Promise<RcloneTargetResult>,
  startRcloneUpload: (config: RcloneUploadConfig) =>
    ipcRenderer.invoke('rclone:upload', config) as Promise<RcloneUploadStartResult>,
  cancelRcloneUpload: (jobId: string) =>
    ipcRenderer.invoke('rclone:cancel-upload', jobId) as Promise<boolean>,
  revealInFolder: (targetPath: string) => ipcRenderer.invoke('shell:reveal', targetPath) as Promise<void>,
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>,
  onEncodeEvent: (listener: (event: EncodeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, encodeEvent: EncodeEvent) => listener(encodeEvent);
    ipcRenderer.on('encode:event', handler);
    return () => ipcRenderer.removeListener('encode:event', handler);
  },
  onRcloneUploadEvent: (listener: (event: RcloneUploadEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, uploadEvent: RcloneUploadEvent) => listener(uploadEvent);
    ipcRenderer.on('rclone-upload:event', handler);
    return () => ipcRenderer.removeListener('rclone-upload:event', handler);
  },
};

contextBridge.exposeInMainWorld('encoder', api);
