import type { EncoderApi } from '../shared/types';

const noEvents = () => () => undefined;

export function installDevEncoderMock(): void {
  if (window.encoder) return;

  const unsupported = async (): Promise<never> => {
    throw new Error('Chức năng native chỉ khả dụng trong cửa sổ Electron.');
  };

  const api: EncoderApi = {
    selectInput: async () => null,
    selectInputs: async () => [],
    selectOutput: async () => null,
    selectSubtitleOutput: async () => null,
    selectHlsFolder: async () => null,
    selectHlsFolders: async () => [],
    selectLogo: async () => '/tmp/dao-phim-logo-preview.png',
    getPathForFile: (file) => file.name,
    probeMedia: unsupported,
    getHardwareAccelerationStatus: async () => ({
      encoders: [
        { id: 'libx264', label: 'CPU · x264', hardware: false },
        { id: 'h264_videotoolbox', label: 'GPU · Apple VideoToolbox', hardware: true },
      ],
      recommendedId: 'h264_videotoolbox',
      message: 'Chế độ xem thử giao diện trong trình duyệt.',
    }),
    exportSubtitles: unsupported,
    startEncode: unsupported,
    cancelEncode: async () => false,
    getRcloneStatus: async () => ({
      available: true,
      version: 'dev-preview',
      remotes: [{ name: 'qa-r2', type: 's3', description: 'Remote kiểm thử giao diện' }],
      message: 'rclone giả lập cho kiểm thử giao diện.',
    }),
    saveRcloneRemote: unsupported,
    testRcloneTarget: async (config) => ({
      destination: `${config.remoteName}:${config.destinationPath}`,
      message: 'Kết nối giả lập thành công.',
    }),
    startRcloneUpload: unsupported,
    cancelRcloneUpload: async () => false,
    revealInFolder: async () => undefined,
    copyText: async () => undefined,
    openExternal: async () => undefined,
    onEncodeEvent: noEvents,
    onRcloneUploadEvent: noEvents,
  };

  window.encoder = api;
}
