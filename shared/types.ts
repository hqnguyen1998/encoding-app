export type PresetId = 'copy-source' | 'adaptive-1080' | 'adaptive-720' | 'single-source';
export type SpeedId = 'fast' | 'balanced' | 'quality';
export type VideoEncoderId = 'auto' | 'libx264' | 'h264_videotoolbox' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf';
export type H264Profile = 'baseline' | 'main' | 'high';
export type ScaleAlgorithm = 'fast_bilinear' | 'bicubic' | 'lanczos';
export type HlsSegmentType = 'mpegts' | 'fmp4';
export type AudioChannels = 'source' | 1 | 2 | 6;
export type AudioSampleRate = 'source' | 44_100 | 48_000;
export type LogoOverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface AdvancedEncodeSettings {
  videoBitratePercent: number;
  cpuCrf: number | null;
  h264Profile: H264Profile;
  outputFps: 'source' | number;
  keyframeIntervalSeconds: 'segment' | number;
  scaleAlgorithm: ScaleAlgorithm;
  deinterlace: boolean;
  audioBitrateKbps: number | null;
  audioChannels: AudioChannels;
  audioSampleRate: AudioSampleRate;
  hlsSegmentType: HlsSegmentType;
  startNumber: number;
}

export interface LogoOverlaySettings {
  enabled: boolean;
  path: string;
  position: LogoOverlayPosition;
  widthPercent: number;
  opacityPercent: number;
  marginPercent: number;
}

export interface VideoEncoderOption {
  id: Exclude<VideoEncoderId, 'auto'>;
  label: string;
  hardware: boolean;
}

export interface HardwareAccelerationStatus {
  encoders: VideoEncoderOption[];
  recommendedId: Exclude<VideoEncoderId, 'auto'>;
  message: string;
}

export type SubtitleKind = 'text' | 'image';

export interface SubtitleTrack {
  streamIndex: number;
  ordinal: number;
  codec: string;
  language: string | null;
  title: string | null;
  kind: SubtitleKind;
  extension: string;
  formatLabel: string;
  isDefault: boolean;
  isForced: boolean;
}

export interface MediaInfo {
  path: string;
  name: string;
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  hasAudio: boolean;
  subtitleTracks: SubtitleTrack[];
}

export interface SubtitleExportConfig {
  inputPath: string;
  outputDirectory: string;
  streamIndices: number[];
}

export interface ExportedSubtitleFile {
  streamIndex: number;
  path: string;
  fileName: string;
  format: string;
}

export interface SubtitleExportResult {
  outputDirectory: string;
  files: ExportedSubtitleFile[];
}

export interface EncodeConfig {
  inputPath: string;
  outputDirectory: string;
  presetId: PresetId;
  speedId: SpeedId;
  segmentDuration: number;
  videoEncoderId?: VideoEncoderId;
  advanced?: Partial<AdvancedEncodeSettings>;
  logoOverlay?: Partial<LogoOverlaySettings>;
}

export interface EncodeStartResult {
  jobId: string;
  outputPath: string;
  videoEncoderId: Exclude<VideoEncoderId, 'auto'>;
  videoEncoderLabel: string;
}

export interface EncodeProgress {
  percent: number;
  encodedSeconds: number;
  durationSeconds: number;
  fps: number | null;
  speed: number | null;
  etaSeconds: number | null;
  statusText: string;
}

export type RcloneUploadPerformanceId = 'stable' | 'fast' | 'maximum';

export interface RcloneUploadProgress {
  percent: number;
  bytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  files: number;
  totalFiles: number;
}

export interface OnzloadUser {
  id: string;
  email: string;
  displayName: string | null;
  plan: string;
  role: string;
  status: string;
}

export interface OnzloadCapabilities {
  hls: {
    videoCodec: string;
    pixelFormat: string;
    audioCodec: string;
    audioProfile: string;
    audioChannels: number;
    audioSampleRate: number;
    playlistName: string;
    allowedSegmentDurations: number[];
    allowedSegmentTypes: HlsSegmentType[];
  };
  upload: {
    maxFileSizeBytes: number;
    maxFileSizeLabel: string;
    dailyUploadLimit: number | null;
  };
}

export interface OnzloadSessionState {
  connected: boolean;
  baseUrl: string | null;
  expiresAt: string | null;
  user: OnzloadUser | null;
  capabilities: OnzloadCapabilities | null;
  message: string;
}

export interface OnzloadLoginConfig {
  baseUrl: string;
}

export interface OnzloadUploadConfig {
  sourcePath: string;
  originalName?: string;
  idempotencyKey: string;
  segmentDuration: number;
  performanceId?: RcloneUploadPerformanceId;
  albumId?: string;
}

export interface OnzloadUploadStartResult {
  jobId: string;
}

export interface OnzloadUploadResult {
  uploadId: string;
  assetId: string;
  encodeJobId: string;
  embedUrl: string;
}

export type OnzloadUploadEvent =
  | { type: 'started'; jobId: string; uploadId: string; destination: string }
  | { type: 'progress'; jobId: string; progress: RcloneUploadProgress }
  | { type: 'log'; jobId: string; line: string }
  | { type: 'completed'; jobId: string; result: OnzloadUploadResult }
  | { type: 'cancelled'; jobId: string }
  | { type: 'failed'; jobId: string; message: string };

export type EncodeEvent =
  | { type: 'started'; jobId: string; outputPath: string; videoEncoderId: Exclude<VideoEncoderId, 'auto'>; videoEncoderLabel: string }
  | { type: 'progress'; jobId: string; progress: EncodeProgress }
  | { type: 'log'; jobId: string; line: string }
  | { type: 'completed'; jobId: string; outputPath: string }
  | { type: 'cancelled'; jobId: string }
  | { type: 'failed'; jobId: string; message: string };

export interface EncoderApi {
  selectInput: () => Promise<string | null>;
  selectInputs: () => Promise<string[]>;
  selectOutput: () => Promise<string | null>;
  selectSubtitleOutput: () => Promise<string | null>;
  selectHlsFolder: () => Promise<string | null>;
  selectHlsFolders: () => Promise<string[]>;
  selectLogo: () => Promise<string | null>;
  getPathForFile: (file: File) => string;
  probeMedia: (filePath: string) => Promise<MediaInfo>;
  getHardwareAccelerationStatus: () => Promise<HardwareAccelerationStatus>;
  exportSubtitles: (config: SubtitleExportConfig) => Promise<SubtitleExportResult>;
  startEncode: (config: EncodeConfig) => Promise<EncodeStartResult>;
  cancelEncode: (jobId: string) => Promise<boolean>;
  getOnzloadSession: () => Promise<OnzloadSessionState>;
  loginOnzload: (config: OnzloadLoginConfig) => Promise<OnzloadSessionState>;
  logoutOnzload: () => Promise<OnzloadSessionState>;
  startOnzloadUpload: (config: OnzloadUploadConfig) => Promise<OnzloadUploadStartResult>;
  cancelOnzloadUpload: (jobId: string) => Promise<boolean>;
  revealInFolder: (targetPath: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  onEncodeEvent: (listener: (event: EncodeEvent) => void) => () => void;
  onOnzloadUploadEvent: (listener: (event: OnzloadUploadEvent) => void) => () => void;
}
