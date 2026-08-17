import type { EncoderApi, OnzloadUploadEvent, RcloneUploadEvent, RemoteHlsDownloadEvent } from '../shared/types';

const noEvents = () => () => undefined;

let mockRemoteHlsListener: ((event: RemoteHlsDownloadEvent) => void) | null = null;
let mockUploadListener: ((event: RcloneUploadEvent) => void) | null = null;
let mockOnzloadUploadListener: ((event: OnzloadUploadEvent) => void) | null = null;
let mockRemoteHlsSequence = 0;
let mockUploadSequence = 0;
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
    startRcloneUpload: async (config) => {
      const sequence = ++mockUploadSequence;
      const jobId = `mock-upload-${sequence}`;
      const destination = `${config.remoteName}:${config.destinationPath}/${config.sourcePath.split('/').filter(Boolean).at(-1) ?? `hls-${sequence}`}`;
      setTimeout(() => mockUploadListener?.({ type: 'started', jobId, destination }), 0);
      setTimeout(() => mockUploadListener?.({
        type: 'progress',
        jobId,
        progress: { percent: 48, bytes: 48_000_000, totalBytes: 100_000_000, speedBytesPerSecond: 12_000_000, etaSeconds: 4, files: 48, totalFiles: 100 },
      }), 250);
      setTimeout(() => mockUploadListener?.({ type: 'completed', jobId, destination }), 1_100);
      return { jobId, destination };
    },
    cancelRcloneUpload: async () => false,
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
    startRemoteHlsDownload: async () => {
      const sequence = ++mockRemoteHlsSequence;
      const jobId = `mock-hls-${sequence}`;
      const outputPath = `/tmp/dao-phim-hls-url/mock-${String(sequence).padStart(2, '0')}-hls`;
      setTimeout(() => mockRemoteHlsListener?.({ type: 'started', jobId }), 0);
      setTimeout(() => mockRemoteHlsListener?.({
        type: 'progress',
        jobId,
        progress: { completedFiles: 25, discoveredFiles: 100, bytes: 25_000_000, statusText: 'Đang tải playlist và segment…' },
      }), 100);
      setTimeout(() => mockRemoteHlsListener?.({
        type: 'completed',
        jobId,
        result: { outputPath, rootPlaylistPath: `${outputPath}/master.m3u8`, fileCount: 100, totalBytes: 100_000_000 },
      }), 550);
      return { jobId };
    },
    cancelRemoteHlsDownload: async () => false,
    cleanupRemoteHlsDownload: async () => false,
    selectCloudStorageFiles: async () => [],
    selectCloudStorageFolder: async () => null,
    listCloudStorage: async (config) => ({
      remoteName: config.remoteName,
      path: config.path,
      entries: [
        { name: 'HLS', path: [config.path, 'HLS'].filter(Boolean).join('/'), isDirectory: true, size: 0, modTime: '2026-08-13T10:00:00Z', mimeType: '' },
        { name: 'master.m3u8', path: [config.path, 'master.m3u8'].filter(Boolean).join('/'), isDirectory: false, size: 2048, modTime: '2026-08-13T10:05:00Z', mimeType: 'application/vnd.apple.mpegurl' },
        { name: 'segment_00001.ts', path: [config.path, 'segment_00001.ts'].filter(Boolean).join('/'), isDirectory: false, size: 4_194_304, modTime: '2026-08-13T10:06:00Z', mimeType: 'video/mp2t' },
      ],
    }),
    createCloudStorageFolder: async (config) => ({ path: `${config.path}/${config.name}`, message: 'Đã tạo thư mục giả lập.' }),
    uploadCloudStorageFiles: async (config) => ({ path: config.path, message: `Đã upload giả lập ${config.sourcePaths.length} file.` }),
    uploadCloudStorageFolder: async (config) => ({ path: config.path, message: `Đã upload thư mục giả lập ${config.sourcePath}.` }),
    renameCloudStorageEntry: async (config) => ({ path: config.path, message: `Đã đổi tên giả lập thành ${config.newName}.` }),
    copyCloudStorageEntry: async (config) => ({ path: config.destinationPath, message: 'Đã sao chép giả lập.' }),
    moveCloudStorageEntry: async (config) => ({ path: config.destinationPath, message: 'Đã di chuyển giả lập.' }),
    deleteCloudStorageEntry: async (config) => ({ path: config.path, message: 'Đã xóa giả lập.' }),
    downloadCloudStorageEntry: async (config) => ({ path: config.path, localPath: `/tmp/${config.name}`, message: 'Đã tải xuống giả lập.' }),
    revealInFolder: async () => undefined,
    copyText: async () => undefined,
    openExternal: async () => undefined,
    onEncodeEvent: noEvents,
    onRcloneUploadEvent: (listener) => {
      mockUploadListener = listener;
      return () => { if (mockUploadListener === listener) mockUploadListener = null; };
    },
    onOnzloadUploadEvent: (listener) => {
      mockOnzloadUploadListener = listener;
      return () => { if (mockOnzloadUploadListener === listener) mockOnzloadUploadListener = null; };
    },
    onRemoteHlsDownloadEvent: (listener) => {
      mockRemoteHlsListener = listener;
      return () => { if (mockRemoteHlsListener === listener) mockRemoteHlsListener = null; };
    },
  };

  window.encoder = api;
}
