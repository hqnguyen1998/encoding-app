import type { EncoderApi, OnzloadUploadEvent } from '../shared/types';

const noEvents = () => () => undefined;

let mockOnzloadUploadListener: ((event: OnzloadUploadEvent) => void) | null = null;
let mockOnzloadSequence = 0;

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
    selectHlsFolders: async () => ['/tmp/dao-phim-demo-hls'],
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
    getOnzloadSession: async () => ({
      connected: false,
      baseUrl: null,
      expiresAt: null,
      user: null,
      capabilities: null,
      message: 'Chưa liên kết tài khoản OnzLoad.',
    }),
    loginOnzload: async (config) => ({
      connected: true,
      baseUrl: config.baseUrl,
      expiresAt: '2026-09-15T00:00:00.000Z',
      user: { id: 'dev-user', email: 'member@example.com', displayName: 'Thành viên Demo', plan: 'Community', role: 'USER', status: 'ACTIVE' },
      capabilities: {
        hls: { videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac', audioProfile: 'aac_low', audioChannels: 2, audioSampleRate: 48_000, playlistName: 'master.m3u8', allowedSegmentDurations: [2, 4, 6, 10], allowedSegmentTypes: ['mpegts', 'fmp4'] },
        upload: { maxFileSizeBytes: 5 * 1024 ** 3, maxFileSizeLabel: '5 GB', dailyUploadLimit: null },
      },
      message: 'OnzLoad đã sẵn sàng nhận HLS.',
    }),
    logoutOnzload: async () => ({ connected: false, baseUrl: null, expiresAt: null, user: null, capabilities: null, message: 'Đã ngắt liên kết.' }),
    startOnzloadUpload: async () => {
      const sequence = ++mockOnzloadSequence;
      const jobId = `mock-onzload-${sequence}`;
      const uploadId = `mock-server-upload-${sequence}`;
      setTimeout(() => mockOnzloadUploadListener?.({ type: 'started', jobId, uploadId, destination: `onzloadtmp:media/hls-output/demo/${sequence}/` }), 0);
      setTimeout(() => mockOnzloadUploadListener?.({ type: 'progress', jobId, progress: { percent: 60, bytes: 60_000_000, totalBytes: 100_000_000, speedBytesPerSecond: 12_000_000, etaSeconds: 3, files: 60, totalFiles: 100 } }), 250);
      setTimeout(() => mockOnzloadUploadListener?.({ type: 'completed', jobId, result: { uploadId, assetId: `asset-${sequence}`, encodeJobId: `encode-${sequence}`, embedUrl: `https://onzload.com/embed/asset-${sequence}` } }), 1_100);
      return { jobId };
    },
    cancelOnzloadUpload: async () => false,
    revealInFolder: async () => undefined,
    copyText: async () => undefined,
    openExternal: async () => undefined,
    onEncodeEvent: noEvents,
    onOnzloadUploadEvent: (listener) => {
      mockOnzloadUploadListener = listener;
      return () => { if (mockOnzloadUploadListener === listener) mockOnzloadUploadListener = null; };
    },
  };

  window.encoder = api;
}
