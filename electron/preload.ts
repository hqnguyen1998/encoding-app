import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
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
  getOnzloadSession: () => ipcRenderer.invoke('onzload:session') as Promise<OnzloadSessionState>,
  loginOnzload: (config: OnzloadLoginConfig) =>
    ipcRenderer.invoke('onzload:login', config) as Promise<OnzloadSessionState>,
  logoutOnzload: () => ipcRenderer.invoke('onzload:logout') as Promise<OnzloadSessionState>,
  startOnzloadUpload: (config: OnzloadUploadConfig) =>
    ipcRenderer.invoke('onzload:upload', config) as Promise<OnzloadUploadStartResult>,
  cancelOnzloadUpload: (jobId: string) =>
    ipcRenderer.invoke('onzload:cancel-upload', jobId) as Promise<boolean>,
  revealInFolder: (targetPath: string) => ipcRenderer.invoke('shell:reveal', targetPath) as Promise<void>,
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>,
  onEncodeEvent: (listener: (event: EncodeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, encodeEvent: EncodeEvent) => listener(encodeEvent);
    ipcRenderer.on('encode:event', handler);
    return () => ipcRenderer.removeListener('encode:event', handler);
  },
  onOnzloadUploadEvent: (listener: (event: OnzloadUploadEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, uploadEvent: OnzloadUploadEvent) => listener(uploadEvent);
    ipcRenderer.on('onzload-upload:event', handler);
    return () => ipcRenderer.removeListener('onzload-upload:event', handler);
  },
};

contextBridge.exposeInMainWorld('encoder', api);
