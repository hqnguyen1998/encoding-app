import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  CloudStorageCopyConfig,
  CloudStorageCreateFolderConfig,
  CloudStorageDeleteConfig,
  CloudStorageDownloadConfig,
  CloudStorageListResult,
  CloudStorageMoveConfig,
  CloudStorageOperationResult,
  CloudStorageRenameConfig,
  CloudStorageTargetConfig,
  CloudStorageUploadFilesConfig,
  CloudStorageUploadFolderConfig,
  EncodeConfig,
  EncodeEvent,
  EncodeStartResult,
  EncoderApi,
  HardwareAccelerationStatus,
  MediaInfo,
  OnzloadLoginConfig,
  OnzloadSessionState,
  OnzloadUploadConfig,
  OnzloadUploadEvent,
  OnzloadUploadStartResult,
  RcloneRemoteConfig,
  RcloneRemoteConfigResult,
  RcloneStatus,
  RcloneTargetConfig,
  RcloneTargetResult,
  RcloneUploadConfig,
  RcloneUploadEvent,
  RcloneUploadStartResult,
  RemoteHlsDownloadConfig,
  RemoteHlsDownloadEvent,
  RemoteHlsDownloadStartResult,
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
  getOnzloadSession: () => ipcRenderer.invoke('onzload:session') as Promise<OnzloadSessionState>,
  loginOnzload: (config: OnzloadLoginConfig) =>
    ipcRenderer.invoke('onzload:login', config) as Promise<OnzloadSessionState>,
  logoutOnzload: () => ipcRenderer.invoke('onzload:logout') as Promise<OnzloadSessionState>,
  startOnzloadUpload: (config: OnzloadUploadConfig) =>
    ipcRenderer.invoke('onzload:upload', config) as Promise<OnzloadUploadStartResult>,
  cancelOnzloadUpload: (jobId: string) =>
    ipcRenderer.invoke('onzload:cancel-upload', jobId) as Promise<boolean>,
  startRemoteHlsDownload: (config: RemoteHlsDownloadConfig) =>
    ipcRenderer.invoke('hls-url:download', config) as Promise<RemoteHlsDownloadStartResult>,
  cancelRemoteHlsDownload: (jobId: string) =>
    ipcRenderer.invoke('hls-url:cancel', jobId) as Promise<boolean>,
  cleanupRemoteHlsDownload: (outputPath: string) =>
    ipcRenderer.invoke('hls-url:cleanup', outputPath) as Promise<boolean>,
  selectCloudStorageFiles: () => ipcRenderer.invoke('dialog:select-cloud-storage-files') as Promise<string[]>,
  selectCloudStorageFolder: () => ipcRenderer.invoke('dialog:select-cloud-storage-folder') as Promise<string | null>,
  listCloudStorage: (config: CloudStorageTargetConfig) =>
    ipcRenderer.invoke('cloud-storage:list', config) as Promise<CloudStorageListResult>,
  createCloudStorageFolder: (config: CloudStorageCreateFolderConfig) =>
    ipcRenderer.invoke('cloud-storage:create-folder', config) as Promise<CloudStorageOperationResult>,
  uploadCloudStorageFiles: (config: CloudStorageUploadFilesConfig) =>
    ipcRenderer.invoke('cloud-storage:upload-files', config) as Promise<CloudStorageOperationResult>,
  uploadCloudStorageFolder: (config: CloudStorageUploadFolderConfig) =>
    ipcRenderer.invoke('cloud-storage:upload-folder', config) as Promise<CloudStorageOperationResult>,
  renameCloudStorageEntry: (config: CloudStorageRenameConfig) =>
    ipcRenderer.invoke('cloud-storage:rename', config) as Promise<CloudStorageOperationResult>,
  copyCloudStorageEntry: (config: CloudStorageCopyConfig) =>
    ipcRenderer.invoke('cloud-storage:copy', config) as Promise<CloudStorageOperationResult>,
  moveCloudStorageEntry: (config: CloudStorageMoveConfig) =>
    ipcRenderer.invoke('cloud-storage:move', config) as Promise<CloudStorageOperationResult>,
  deleteCloudStorageEntry: (config: CloudStorageDeleteConfig) =>
    ipcRenderer.invoke('cloud-storage:delete', config) as Promise<CloudStorageOperationResult>,
  downloadCloudStorageEntry: (config: CloudStorageDownloadConfig) =>
    ipcRenderer.invoke('cloud-storage:download', config) as Promise<CloudStorageOperationResult | null>,
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
  onOnzloadUploadEvent: (listener: (event: OnzloadUploadEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, uploadEvent: OnzloadUploadEvent) => listener(uploadEvent);
    ipcRenderer.on('onzload-upload:event', handler);
    return () => ipcRenderer.removeListener('onzload-upload:event', handler);
  },
  onRemoteHlsDownloadEvent: (listener: (event: RemoteHlsDownloadEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, downloadEvent: RemoteHlsDownloadEvent) => listener(downloadEvent);
    ipcRenderer.on('hls-url-download:event', handler);
    return () => ipcRenderer.removeListener('hls-url-download:event', handler);
  },
};

contextBridge.exposeInMainWorld('encoder', api);
