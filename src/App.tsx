import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Captions,
  Clock3,
  CloudUpload,
  Cpu,
  Download,
  File as FileIcon,
  FileVideo2,
  Film,
  Folder,
  FolderPlus,
  FolderOpen,
  Gauge,
  HardDrive,
  Home,
  ImageIcon,
  Layers3,
  Link2,
  ListOrdered,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  Upload,
  ExternalLink,
  X,
  Zap,
} from 'lucide-react';
import { PRESETS, SPEEDS } from '../shared/presets';
import { DEFAULT_ADVANCED_ENCODE_SETTINGS } from '../shared/encode-settings';
import { DEFAULT_LOGO_OVERLAY_SETTINGS } from '../shared/logo-overlay';
import { buildPublicHlsUrl, buildPublicStorageUrl, normalizePublicBaseUrl } from '../shared/public-url';
import { RCLONE_UPLOAD_PERFORMANCE_PROFILES } from '../shared/upload-performance';
import { scrollLogContainerToEnd } from './log-scroll';
import { localMediaUrl } from './local-media-url';
import { logoPreviewStyle } from './logo-preview';
import { loadAppPreferences, saveAppPreferences } from './preferences';
import { isValidRemoteHlsUrl, parseRemoteHlsUrlLines } from './remote-hls-input';
import {
  getParallelQueueReadiness,
  nextQueuedItem,
  queueStatusLabel,
  removeQueueItem,
  summarizeQueue,
  updateQueueItem,
  type QueueItemStatus,
} from '../shared/queue';
import type {
  AdvancedEncodeSettings,
  CloudStorageEntry,
  EncodeConfig,
  EncodeEvent,
  EncodeProgress,
  HardwareAccelerationStatus,
  LogoOverlaySettings,
  MediaInfo,
  OnzloadSessionState,
  OnzloadUploadEvent,
  PresetId,
  RcloneStatus,
  RcloneProvider,
  RcloneRemoteConfig,
  RcloneUploadConfig,
  RcloneUploadEvent,
  RcloneUploadPerformanceId,
  RcloneUploadProgress,
  RemoteHlsDownloadEvent,
  RemoteHlsDownloadProgress,
  SpeedId,
  VideoEncoderId,
} from '../shared/types';

type AppStatus = 'idle' | 'probing' | 'ready' | 'encoding' | 'completed' | 'failed' | 'cancelled';
type SubtitleExportStatus = 'idle' | 'exporting' | 'success' | 'failed';
type UploadStatus = 'idle' | 'uploading' | 'success' | 'failed' | 'cancelled';
type TargetCheckStatus = 'idle' | 'checking' | 'success' | 'failed';
type RemoteSaveStatus = 'idle' | 'saving' | 'success' | 'failed';
type RemoteHlsStatus = 'idle' | 'downloading' | 'success' | 'failed' | 'cancelled';
type AppTab = 'encode' | 'upload' | 'url-upload' | 'storage';
type CloudActionStatus = 'idle' | 'working' | 'success' | 'failed';

interface EncodeQueueItem {
  id: string;
  media: MediaInfo;
  status: QueueItemStatus;
  config: EncodeConfig | null;
  autoUploadTarget: Omit<RcloneUploadConfig, 'sourcePath'> | null;
  autoUploadOnzload: boolean;
  jobId: string | null;
  outputPath: string;
  progress: EncodeProgress | null;
  videoEncoderLabel: string;
  error: string;
}

interface OnzloadQueueItem {
  id: string;
  sourcePath: string;
  originalName: string;
  segmentDuration: number;
  idempotencyKey: string;
  status: QueueItemStatus;
  jobId: string | null;
  uploadId: string;
  destination: string;
  embedUrl: string;
  progress: RcloneUploadProgress | null;
  error: string;
}

interface UploadQueueItem {
  id: string;
  sourcePath: string;
  status: QueueItemStatus;
  config: RcloneUploadConfig | null;
  jobId: string | null;
  destination: string;
  publicUrl: string;
  progress: RcloneUploadProgress | null;
  error: string;
  temporarySource: boolean;
  stopQueueAfterComplete: boolean;
}

interface RemoteHlsBatchRun {
  urls: string[];
  index: number;
  outputPaths: string[];
  failures: string[];
  folderPrefix: string;
  target: Omit<RcloneUploadConfig, 'sourcePath'>;
  downloadsComplete: boolean;
}

interface RemoteHlsBatchProgress {
  total: number;
  processed: number;
  downloaded: number;
  failed: number;
  uploaded: number;
  uploadFailed: number;
}

const ACCEPTED_EXTENSIONS = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'mts'];
const LOGO_POSITIONS: Array<{ id: LogoOverlaySettings['position']; label: string }> = [
  { id: 'top-left', label: 'Trên trái' },
  { id: 'top-right', label: 'Trên phải' },
  { id: 'bottom-left', label: 'Dưới trái' },
  { id: 'bottom-right', label: 'Dưới phải' },
  { id: 'center', label: 'Chính giữa' },
];

function createQueueId(prefix: 'encode' | 'upload' | 'onzload'): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function initialEncodeProgress(durationSeconds: number): EncodeProgress {
  return {
    percent: 0,
    encodedSeconds: 0,
    durationSeconds,
    fps: null,
    speed: null,
    etaSeconds: null,
    statusText: 'Đang chuẩn bị FFmpeg',
  };
}

function initialUploadProgress(): RcloneUploadProgress {
  return {
    percent: 0,
    bytes: 0,
    totalBytes: 0,
    speedBytesPerSecond: 0,
    etaSeconds: null,
    files: 0,
    totalFiles: 0,
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function formatFps(fps: number | null): string {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) return '—';
  const rounded = Math.round(fps * 1_000) / 1_000;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(3).replace(/0+$/, '')} fps`;
}

function formatCloudDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function parentCloudStoragePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

function directoryOf(filePath: string): string {
  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return separator > 0 ? filePath.slice(0, separator) : '';
}

function baseNameOf(filePath: string): string {
  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return separator >= 0 ? filePath.slice(separator + 1) : filePath;
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
    .replace(/^Error:\s*/, '');
}

function renditionSummary(media: MediaInfo | null, presetId: PresetId): string {
  const preset = PRESETS.find((item) => item.id === presetId)!;
  if (preset.videoMode === 'copy') {
    return media ? `${media.height}p · không encode lại` : 'H.264 gốc · AAC 192k';
  }
  if (preset.renditions === 'source') return media ? `${media.height}p` : 'Theo nguồn';
  if (!media) return preset.description;
  const available = preset.renditions.filter((item) => item.height <= media.height + 8);
  return available.length > 0 ? available.map((item) => item.label).join(' · ') : `${media.height}p`;
}

function EmptyProgress() {
  return (
    <div className="empty-progress">
      <div className="empty-orbit" aria-hidden="true">
        <div className="empty-orbit-dot" />
        <Film size={28} strokeWidth={1.6} />
      </div>
      <div>
        <h3>Sẵn sàng để tạo HLS</h3>
        <p>Chọn một video và cấu hình encode. Mọi xử lý đều diễn ra trên máy của bạn.</p>
      </div>
    </div>
  );
}

function SourcePreview({ media, logoOverlay }: { media: MediaInfo; logoOverlay: LogoOverlaySettings }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewUrl = useMemo(() => localMediaUrl(media.path), [media.path]);
  const logoUrl = useMemo(
    () => (logoOverlay.enabled && logoOverlay.path ? localMediaUrl(logoOverlay.path) : ''),
    [logoOverlay.enabled, logoOverlay.path],
  );
  const previewLogoStyle = useMemo(
    () => logoPreviewStyle(logoOverlay, media.width, media.height),
    [logoOverlay, media.height, media.width],
  );

  useEffect(() => setPreviewFailed(false), [previewUrl]);

  return (
    <div className="source-preview">
      <div className="source-preview-frame" style={{ aspectRatio: `${media.width} / ${media.height}` }}>
        {!previewFailed ? (
          <video
            key={previewUrl}
            src={previewUrl}
            controls
            preload="metadata"
            playsInline
            onError={() => setPreviewFailed(true)}
          >
            Trình phát video không được hỗ trợ.
          </video>
        ) : (
          <div className="source-preview-fallback">
            <FileVideo2 size={30} strokeWidth={1.5} />
            <span>Codec hoặc container này không phát trực tiếp được trong Electron, nhưng vẫn có thể encode bình thường.</span>
          </div>
        )}
        {logoUrl && (
          <img
            className="source-preview-logo"
            src={logoUrl}
            alt=""
            draggable={false}
            style={previewLogoStyle}
          />
        )}
      </div>
      <div className="source-preview-copy">
        <span>Video nguồn · xem trước</span>
        <h3 title={media.name}>{media.name}</h3>
        <p>{media.width} × {media.height} · {formatDuration(media.durationSeconds)} · {media.videoCodec.toUpperCase()}{media.audioCodec ? ` / ${media.audioCodec.toUpperCase()}` : ''}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [savedPreferences] = useState(() => loadAppPreferences(window.localStorage));
  const [activeTab, setActiveTab] = useState<AppTab>(savedPreferences.activeTab);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [outputDirectory, setOutputDirectory] = useState(savedPreferences.encode.outputDirectory);
  const [presetId, setPresetId] = useState<PresetId>(savedPreferences.encode.presetId);
  const [speedId, setSpeedId] = useState<SpeedId>(savedPreferences.encode.speedId);
  const [segmentDuration, setSegmentDuration] = useState(savedPreferences.encode.segmentDuration);
  const [videoEncoderId, setVideoEncoderId] = useState<VideoEncoderId>(savedPreferences.encode.videoEncoderId);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(savedPreferences.encode.showAdvancedSettings);
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedEncodeSettings>(savedPreferences.encode.advancedSettings);
  const [logoOverlay, setLogoOverlay] = useState<LogoOverlaySettings>(savedPreferences.encode.logoOverlay);
  const [hardwareAcceleration, setHardwareAcceleration] = useState<HardwareAccelerationStatus>({
    encoders: [{ id: 'libx264', label: 'CPU · x264', hardware: false }],
    recommendedId: 'libx264',
    message: 'Đang kiểm tra GPU…',
  });
  const [isHardwareLoading, setIsHardwareLoading] = useState(true);
  const [activeVideoEncoderLabel, setActiveVideoEncoderLabel] = useState('');
  const [status, setStatus] = useState<AppStatus>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState('');
  const [progress, setProgress] = useState<EncodeProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedSubtitleIndices, setSelectedSubtitleIndices] = useState<number[]>([]);
  const [subtitleExportStatus, setSubtitleExportStatus] = useState<SubtitleExportStatus>('idle');
  const [subtitleExportMessage, setSubtitleExportMessage] = useState('');
  const [subtitleOutputDirectory, setSubtitleOutputDirectory] = useState('');
  const [rcloneStatus, setRcloneStatus] = useState<RcloneStatus>({
    available: false,
    version: null,
    remotes: [],
    message: 'Đang tìm rclone…',
  });
  const [isRcloneLoading, setIsRcloneLoading] = useState(true);
  const [selectedRemote, setSelectedRemote] = useState(savedPreferences.upload.selectedRemote);
  const [remoteDestinationPath, setRemoteDestinationPath] = useState(savedPreferences.upload.remoteDestinationPath);
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [copiedPublicUrl, setCopiedPublicUrl] = useState('');
  const [uploadAfterEncode, setUploadAfterEncode] = useState(savedPreferences.upload.uploadAfterEncode);
  const [uploadPerformanceId, setUploadPerformanceId] = useState<RcloneUploadPerformanceId>(savedPreferences.upload.performanceId);
  const [targetCheckStatus, setTargetCheckStatus] = useState<TargetCheckStatus>('idle');
  const [targetCheckMessage, setTargetCheckMessage] = useState('');
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<RcloneUploadProgress | null>(null);
  const [uploadDestination, setUploadDestination] = useState('');
  const [uploadPublicUrl, setUploadPublicUrl] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);
  const [localHlsPath, setLocalHlsPath] = useState('');
  const [cloudStoragePath, setCloudStoragePath] = useState(
    savedPreferences.upload.cloudStoragePath || savedPreferences.upload.remoteDestinationPath,
  );
  const [cloudStorageEntries, setCloudStorageEntries] = useState<CloudStorageEntry[]>([]);
  const [cloudStorageLoading, setCloudStorageLoading] = useState(false);
  const [cloudStorageLoadedRemote, setCloudStorageLoadedRemote] = useState('');
  const [cloudStorageSearch, setCloudStorageSearch] = useState('');
  const [selectedCloudStoragePath, setSelectedCloudStoragePath] = useState('');
  const [cloudNewFolderName, setCloudNewFolderName] = useState('');
  const [cloudRenameName, setCloudRenameName] = useState('');
  const [cloudCopyDestination, setCloudCopyDestination] = useState('');
  const [cloudMoveDestination, setCloudMoveDestination] = useState('');
  const [cloudDeleteArmedPath, setCloudDeleteArmedPath] = useState('');
  const [cloudActionStatus, setCloudActionStatus] = useState<CloudActionStatus>('idle');
  const [cloudActionMessage, setCloudActionMessage] = useState('');
  const [remoteHlsUrl, setRemoteHlsUrl] = useState('');
  const [remoteHlsFolderName, setRemoteHlsFolderName] = useState('');
  const [remoteHlsStatus, setRemoteHlsStatus] = useState<RemoteHlsStatus>('idle');
  const [remoteHlsJobId, setRemoteHlsJobId] = useState<string | null>(null);
  const [remoteHlsProgress, setRemoteHlsProgress] = useState<RemoteHlsDownloadProgress | null>(null);
  const [remoteHlsMessage, setRemoteHlsMessage] = useState('');
  const [remoteHlsBatchSourcePaths, setRemoteHlsBatchSourcePaths] = useState<string[]>([]);
  const [remoteHlsBatchProgress, setRemoteHlsBatchProgress] = useState<RemoteHlsBatchProgress>({
    total: 0,
    processed: 0,
    downloaded: 0,
    failed: 0,
    uploaded: 0,
    uploadFailed: 0,
  });
  const [encodeQueue, setEncodeQueue] = useState<EncodeQueueItem[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [onzloadQueue, setOnzloadQueue] = useState<OnzloadQueueItem[]>([]);
  const [encodeQueueRunning, setEncodeQueueRunning] = useState(false);
  const [uploadQueueRunning, setUploadQueueRunning] = useState(false);
  const [activeEncodeQueueItemId, setActiveEncodeQueueItemId] = useState<string | null>(null);
  const [activeUploadQueueItemId, setActiveUploadQueueItemId] = useState<string | null>(null);
  const [onzloadQueueRunning, setOnzloadQueueRunning] = useState(false);
  const [activeOnzloadQueueItemId, setActiveOnzloadQueueItemId] = useState<string | null>(null);
  const [onzloadBaseUrl, setOnzloadBaseUrl] = useState(() => window.localStorage.getItem('dao-encoding:onzload-url') || 'https://onzload.com');
  const [onzloadSession, setOnzloadSession] = useState<OnzloadSessionState>({
    connected: false,
    baseUrl: null,
    expiresAt: null,
    user: null,
    capabilities: null,
    message: 'Đang kiểm tra phiên OnzLoad…',
  });
  const [onzloadAuthBusy, setOnzloadAuthBusy] = useState(false);
  const [uploadAfterEncodeOnzload, setUploadAfterEncodeOnzload] = useState(() => window.localStorage.getItem('dao-encoding:onzload-auto') === 'true');
  const [onzloadLogs, setOnzloadLogs] = useState<string[]>([]);
  const [remoteProvider, setRemoteProvider] = useState<RcloneProvider>(savedPreferences.remoteDraft.provider);
  const [remoteName, setRemoteName] = useState(savedPreferences.remoteDraft.name);
  const [remoteAccessKeyId, setRemoteAccessKeyId] = useState(savedPreferences.remoteDraft.accessKeyId);
  const [remoteSecretAccessKey, setRemoteSecretAccessKey] = useState('');
  const [remoteEndpoint, setRemoteEndpoint] = useState(savedPreferences.remoteDraft.endpoint);
  const [remoteRegion, setRemoteRegion] = useState(savedPreferences.remoteDraft.region);
  const [remoteSaveStatus, setRemoteSaveStatus] = useState<RemoteSaveStatus>('idle');
  const [remoteSaveMessage, setRemoteSaveMessage] = useState('');
  const dropDepth = useRef(0);
  const logOutputRef = useRef<HTMLDivElement>(null);
  const encodeQueueRef = useRef<EncodeQueueItem[]>([]);
  const uploadQueueRef = useRef<UploadQueueItem[]>([]);
  const onzloadQueueRef = useRef<OnzloadQueueItem[]>([]);
  const activeEncodeQueueItemIdRef = useRef<string | null>(null);
  const activeUploadQueueItemIdRef = useRef<string | null>(null);
  const activeOnzloadQueueItemIdRef = useRef<string | null>(null);
  const remoteHlsUploadTargetRef = useRef<Omit<RcloneUploadConfig, 'sourcePath'> | null>(null);
  const remoteHlsBatchRef = useRef<RemoteHlsBatchRun | null>(null);
  const remoteHlsBatchSummaryRef = useRef<RemoteHlsBatchProgress>({
    total: 0,
    processed: 0,
    downloaded: 0,
    failed: 0,
    uploaded: 0,
    uploadFailed: 0,
  });

  const replaceEncodeQueue = useCallback((updater: (items: EncodeQueueItem[]) => EncodeQueueItem[]) => {
    const next = updater(encodeQueueRef.current);
    encodeQueueRef.current = next;
    setEncodeQueue(next);
  }, []);

  const replaceUploadQueue = useCallback((updater: (items: UploadQueueItem[]) => UploadQueueItem[]) => {
    const next = updater(uploadQueueRef.current);
    uploadQueueRef.current = next;
    setUploadQueue(next);
  }, []);

  const replaceOnzloadQueue = useCallback((updater: (items: OnzloadQueueItem[]) => OnzloadQueueItem[]) => {
    const next = updater(onzloadQueueRef.current);
    onzloadQueueRef.current = next;
    setOnzloadQueue(next);
  }, []);

  const setActiveEncodeQueueItem = useCallback((id: string | null) => {
    activeEncodeQueueItemIdRef.current = id;
    setActiveEncodeQueueItemId(id);
  }, []);

  const setActiveUploadQueueItem = useCallback((id: string | null) => {
    activeUploadQueueItemIdRef.current = id;
    setActiveUploadQueueItemId(id);
  }, []);

  const setActiveOnzloadQueueItem = useCallback((id: string | null) => {
    activeOnzloadQueueItemIdRef.current = id;
    setActiveOnzloadQueueItemId(id);
  }, []);

  const isSubtitleExporting = subtitleExportStatus === 'exporting';
  const isUploading = uploadStatus === 'uploading';
  const isRemoteHlsDownloading = remoteHlsStatus === 'downloading';
  const isBusy = status === 'probing' || status === 'encoding' || isSubtitleExporting || isUploading || isRemoteHlsDownloading || encodeQueueRunning || uploadQueueRunning;
  const encodeQueueSummary = useMemo(() => summarizeQueue(encodeQueue), [encodeQueue]);
  const uploadQueueSummary = useMemo(() => summarizeQueue(uploadQueue), [uploadQueue]);
  const onzloadQueueSummary = useMemo(() => summarizeQueue(onzloadQueue), [onzloadQueue]);
  const queueReadiness = getParallelQueueReadiness({
    encodeQueueRunning,
    uploadQueueRunning,
    activeEncodeItemId: activeEncodeQueueItemId,
    activeUploadItemId: activeUploadQueueItemId,
    sharedBlocker: isSubtitleExporting,
  });
  const canStart = Boolean(
    encodeQueueSummary.queued > 0 &&
    outputDirectory &&
    (!logoOverlay.enabled || (logoOverlay.path && presetId !== 'copy-source')) &&
    (!uploadAfterEncodeOnzload || onzloadSession.connected) &&
    !isSubtitleExporting &&
    !isRemoteHlsDownloading,
  );
  const selectedPreset = PRESETS.find((item) => item.id === presetId)!;
  const selectedUploadPerformance = RCLONE_UPLOAD_PERFORMANCE_PROFILES.find(
    (profile) => profile.id === uploadPerformanceId,
  ) ?? RCLONE_UPLOAD_PERFORMANCE_PROFILES[1];
  const selectedVideoEncoderLabel = selectedPreset.videoMode === 'copy'
    ? 'Stream Copy · không encode video'
    : videoEncoderId === 'auto'
      ? `Tự động · ${hardwareAcceleration.encoders.find((item) => item.id === hardwareAcceleration.recommendedId)?.label ?? 'CPU · x264'}`
      : hardwareAcceleration.encoders.find((item) => item.id === videoEncoderId)?.label ?? 'CPU · x264';
  const selectedConcreteEncoderId = videoEncoderId === 'auto'
    ? hardwareAcceleration.recommendedId
    : videoEncoderId;
  const cpuCrfAvailable = selectedPreset.videoMode !== 'copy' && selectedConcreteEncoderId === 'libx264';
  const hasCustomAdvancedSettings = JSON.stringify(advancedSettings) !== JSON.stringify(DEFAULT_ADVANCED_ENCODE_SETTINGS);
  const uploadConfigured = Boolean(rcloneStatus.available && selectedRemote && remoteDestinationPath.trim());
  const normalizedPublicBaseUrl = useMemo(() => {
    try {
      return normalizePublicBaseUrl(publicBaseUrl);
    } catch {
      return '';
    }
  }, [publicBaseUrl]);
  const publicBaseUrlError = useMemo(() => {
    try {
      normalizePublicBaseUrl(publicBaseUrl);
      return '';
    } catch (error) {
      return cleanError(error);
    }
  }, [publicBaseUrl]);
  const parsedRemoteHlsUrls = useMemo(() => parseRemoteHlsUrlLines(remoteHlsUrl), [remoteHlsUrl]);
  const invalidRemoteHlsUrlCount = useMemo(
    () => parsedRemoteHlsUrls.filter((url) => !isValidRemoteHlsUrl(url)).length,
    [parsedRemoteHlsUrls],
  );
  const remoteHlsUrlIsValid = parsedRemoteHlsUrls.length > 0 && invalidRemoteHlsUrlCount === 0;
  const canUpload = Boolean(
    uploadQueueSummary.queued > 0 &&
    uploadQueue.every((item) => item.status !== 'queued' || item.config || uploadConfigured) &&
    !isUploading &&
    !isSubtitleExporting &&
    !isRemoteHlsDownloading &&
    !publicBaseUrlError,
  );
  const remoteCanSave = Boolean(
    remoteName.trim() &&
    remoteAccessKeyId.trim() &&
    remoteSecretAccessKey.trim() &&
    (remoteProvider === 'AWS' || remoteEndpoint.trim()) &&
    remoteSaveStatus !== 'saving' &&
    !isUploading,
  );
  const destinationPreview = selectedRemote
    ? `${selectedRemote}:${[
      remoteDestinationPath.trim().replace(/^\/+|\/+$/g, ''),
      localHlsPath ? baseNameOf(localHlsPath) : 'ten-video-hls',
    ].filter(Boolean).join('/')}`
    : 'Chọn remote để xem đường dẫn đích';
  const publicUrlPreview = buildPublicHlsUrl({
    publicBaseUrl: normalizedPublicBaseUrl,
    destinationPath: remoteDestinationPath,
    sourcePath: localHlsPath || 'ten-video-hls',
  });
  const filteredCloudStorageEntries = useMemo(() => {
    const query = cloudStorageSearch.trim().toLocaleLowerCase('vi');
    return query
      ? cloudStorageEntries.filter((entry) => entry.name.toLocaleLowerCase('vi').includes(query))
      : cloudStorageEntries;
  }, [cloudStorageEntries, cloudStorageSearch]);
  const selectedCloudStorageEntry = useMemo(
    () => cloudStorageEntries.find((entry) => entry.path === selectedCloudStoragePath) ?? null,
    [cloudStorageEntries, selectedCloudStoragePath],
  );
  const selectedCloudStoragePublicUrl = selectedCloudStorageEntry
    ? buildPublicStorageUrl({
      publicBaseUrl: normalizedPublicBaseUrl,
      storagePath: selectedCloudStorageEntry.path,
      directory: selectedCloudStorageEntry.isDirectory,
    })
    : '';
  const selectedCloudStorageHlsUrl = selectedCloudStorageEntry?.isDirectory
    ? buildPublicStorageUrl({
      publicBaseUrl: normalizedPublicBaseUrl,
      storagePath: selectedCloudStorageEntry.path,
      appendFile: 'master.m3u8',
    })
    : '';
  const cloudActionBusy = cloudActionStatus === 'working';
  const cloudFolderCount = cloudStorageEntries.filter((entry) => entry.isDirectory).length;
  const cloudFileCount = cloudStorageEntries.length - cloudFolderCount;
  const cloudTotalBytes = cloudStorageEntries.reduce((total, entry) => total + (entry.isDirectory ? 0 : entry.size), 0);

  const refreshRclone = useCallback(async (preferredRemote = '') => {
    setIsRcloneLoading(true);
    setTargetCheckStatus('idle');
    setTargetCheckMessage('');
    try {
      const result = await window.encoder.getRcloneStatus();
      setRcloneStatus(result);
      setSelectedRemote((current) => {
        if (preferredRemote && result.remotes.some((remote) => remote.name === preferredRemote)) return preferredRemote;
        return result.remotes.some((remote) => remote.name === current) ? current : result.remotes[0]?.name ?? '';
      });
    } catch (error) {
      setRcloneStatus({ available: false, version: null, remotes: [], message: cleanError(error) });
      setSelectedRemote('');
    } finally {
      setIsRcloneLoading(false);
    }
  }, []);

  const refreshOnzload = useCallback(async () => {
    try {
      const session = await window.encoder.getOnzloadSession();
      setOnzloadSession(session);
      if (session.baseUrl) setOnzloadBaseUrl(session.baseUrl);
    } catch (error) {
      setOnzloadSession({
        connected: false,
        baseUrl: null,
        expiresAt: null,
        user: null,
        capabilities: null,
        message: cleanError(error),
      });
    }
  }, []);

  const connectOnzload = async () => {
    setOnzloadAuthBusy(true);
    try {
      const session = await window.encoder.loginOnzload({ baseUrl: onzloadBaseUrl });
      setOnzloadSession(session);
      if (session.baseUrl) setOnzloadBaseUrl(session.baseUrl);
    } catch (error) {
      setOnzloadSession((current) => ({ ...current, message: cleanError(error) }));
    } finally {
      setOnzloadAuthBusy(false);
    }
  };

  const disconnectOnzload = async () => {
    setOnzloadAuthBusy(true);
    try {
      const session = await window.encoder.logoutOnzload();
      setOnzloadSession(session);
      setUploadAfterEncodeOnzload(false);
    } catch (error) {
      setOnzloadSession((current) => ({ ...current, message: cleanError(error) }));
    } finally {
      setOnzloadAuthBusy(false);
    }
  };

  const refreshHardwareAcceleration = useCallback(async () => {
    setIsHardwareLoading(true);
    try {
      const result = await window.encoder.getHardwareAccelerationStatus();
      setHardwareAcceleration(result);
      setVideoEncoderId((current) => (
        current === 'auto' || result.encoders.some((encoder) => encoder.id === current) ? current : 'auto'
      ));
    } catch (error) {
      setHardwareAcceleration({
        encoders: [{ id: 'libx264', label: 'CPU · x264', hardware: false }],
        recommendedId: 'libx264',
        message: cleanError(error),
      });
    } finally {
      setIsHardwareLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRemote) {
      setPublicBaseUrl('');
      return;
    }
    setPublicBaseUrl(localStorage.getItem(`dao-phim:public-base-url:${selectedRemote}`) ?? '');
  }, [selectedRemote]);

  useEffect(() => {
    saveAppPreferences(window.localStorage, {
      version: 1,
      activeTab,
      encode: {
        outputDirectory,
        presetId,
        speedId,
        segmentDuration,
        videoEncoderId,
        showAdvancedSettings,
        advancedSettings,
        logoOverlay,
      },
      upload: {
        selectedRemote,
        remoteDestinationPath,
        uploadAfterEncode,
        performanceId: uploadPerformanceId,
        cloudStoragePath,
      },
      remoteDraft: {
        provider: remoteProvider,
        name: remoteName,
        accessKeyId: remoteAccessKeyId,
        endpoint: remoteEndpoint,
        region: remoteRegion,
      },
    });
  }, [
    activeTab,
    advancedSettings,
    cloudStoragePath,
    logoOverlay,
    outputDirectory,
    presetId,
    remoteAccessKeyId,
    remoteDestinationPath,
    remoteEndpoint,
    remoteName,
    remoteProvider,
    remoteRegion,
    segmentDuration,
    selectedRemote,
    showAdvancedSettings,
    speedId,
    uploadAfterEncode,
    uploadPerformanceId,
    videoEncoderId,
  ]);

  const changePublicBaseUrl = (value: string) => {
    setPublicBaseUrl(value);
    setCopiedPublicUrl('');
    if (selectedRemote) localStorage.setItem(`dao-phim:public-base-url:${selectedRemote}`, value);
  };

  const copyPublicUrl = async (url: string) => {
    if (!url) return;
    await window.encoder.copyText(url);
    setCopiedPublicUrl(url);
  };

  const loadCloudStorage = useCallback(async (pathOverride?: string, preserveActionState = false): Promise<boolean> => {
    if (!selectedRemote) {
      setCloudActionStatus('failed');
      setCloudActionMessage('Hãy cấu hình và chọn remote rclone trước.');
      return false;
    }
    const targetPath = pathOverride ?? cloudStoragePath;
    setCloudStorageLoading(true);
    if (!preserveActionState) {
      setCloudActionStatus('idle');
      setCloudActionMessage('');
    }
    setCloudDeleteArmedPath('');
    try {
      const result = await window.encoder.listCloudStorage({ remoteName: selectedRemote, path: targetPath });
      setCloudStoragePath(result.path);
      setCloudStorageEntries(result.entries);
      setCloudStorageLoadedRemote(selectedRemote);
      setSelectedCloudStoragePath('');
      setCloudRenameName('');
      setCloudCopyDestination('');
      setCloudMoveDestination('');
      return true;
    } catch (error) {
      setCloudStorageEntries([]);
      setCloudStorageLoadedRemote(selectedRemote);
      setCloudActionStatus('failed');
      setCloudActionMessage(cleanError(error));
      return false;
    } finally {
      setCloudStorageLoading(false);
    }
  }, [cloudStoragePath, selectedRemote]);

  const runCloudStorageAction = async (
    action: () => Promise<{ message: string } | null>,
    options: { refresh?: boolean; clearSelection?: boolean } = { refresh: true },
  ) => {
    if (cloudActionBusy) return;
    setCloudActionStatus('working');
    setCloudActionMessage('Đang thực hiện thao tác bằng rclone…');
    setCloudDeleteArmedPath('');
    try {
      const result = await action();
      if (!result) {
        setCloudActionStatus('idle');
        setCloudActionMessage('');
        return;
      }
      if (options.clearSelection) {
        setSelectedCloudStoragePath('');
        setCloudRenameName('');
        setCloudCopyDestination('');
        setCloudMoveDestination('');
      }
      const refreshed = options.refresh === false ? true : await loadCloudStorage(cloudStoragePath, true);
      if (refreshed) {
        setCloudActionStatus('success');
        setCloudActionMessage(result.message);
      }
    } catch (error) {
      setCloudActionStatus('failed');
      setCloudActionMessage(cleanError(error));
    }
  };

  const selectCloudStorageEntry = (entry: CloudStorageEntry) => {
    setSelectedCloudStoragePath(entry.path);
    setCloudRenameName(entry.name);
    setCloudCopyDestination(entry.path);
    setCloudMoveDestination(entry.path);
    setCloudDeleteArmedPath('');
  };

  const createCloudFolder = async () => {
    if (!selectedRemote || !cloudNewFolderName.trim()) return;
    await runCloudStorageAction(
      () => window.encoder.createCloudStorageFolder({
        remoteName: selectedRemote,
        path: cloudStoragePath,
        name: cloudNewFolderName,
      }),
    );
    setCloudNewFolderName('');
  };

  const uploadCloudFiles = async () => {
    if (!selectedRemote || cloudActionBusy) return;
    const sourcePaths = await window.encoder.selectCloudStorageFiles();
    if (sourcePaths.length === 0) return;
    await runCloudStorageAction(() => window.encoder.uploadCloudStorageFiles({
      remoteName: selectedRemote,
      path: cloudStoragePath,
      sourcePaths,
    }));
  };

  const uploadCloudFolder = async () => {
    if (!selectedRemote || cloudActionBusy) return;
    const sourcePath = await window.encoder.selectCloudStorageFolder();
    if (!sourcePath) return;
    await runCloudStorageAction(() => window.encoder.uploadCloudStorageFolder({
      remoteName: selectedRemote,
      path: cloudStoragePath,
      sourcePath,
    }));
  };

  const renameSelectedCloudEntry = async () => {
    if (!selectedRemote || !selectedCloudStorageEntry || !cloudRenameName.trim()) return;
    await runCloudStorageAction(
      () => window.encoder.renameCloudStorageEntry({
        remoteName: selectedRemote,
        path: selectedCloudStorageEntry.path,
        isDirectory: selectedCloudStorageEntry.isDirectory,
        newName: cloudRenameName,
      }),
      { refresh: true, clearSelection: true },
    );
  };

  const copySelectedCloudEntry = async () => {
    if (!selectedRemote || !selectedCloudStorageEntry || !cloudCopyDestination.trim()) return;
    await runCloudStorageAction(() => window.encoder.copyCloudStorageEntry({
      remoteName: selectedRemote,
      path: selectedCloudStorageEntry.path,
      destinationPath: cloudCopyDestination,
      isDirectory: selectedCloudStorageEntry.isDirectory,
    }));
  };

  const moveSelectedCloudEntry = async () => {
    if (!selectedRemote || !selectedCloudStorageEntry || !cloudMoveDestination.trim()) return;
    await runCloudStorageAction(
      () => window.encoder.moveCloudStorageEntry({
        remoteName: selectedRemote,
        path: selectedCloudStorageEntry.path,
        destinationPath: cloudMoveDestination,
        isDirectory: selectedCloudStorageEntry.isDirectory,
      }),
      { refresh: true, clearSelection: true },
    );
  };

  const downloadSelectedCloudEntry = async () => {
    if (!selectedRemote || !selectedCloudStorageEntry) return;
    await runCloudStorageAction(
      () => window.encoder.downloadCloudStorageEntry({
        remoteName: selectedRemote,
        path: selectedCloudStorageEntry.path,
        isDirectory: selectedCloudStorageEntry.isDirectory,
        name: selectedCloudStorageEntry.name,
      }),
      { refresh: false },
    );
  };

  const deleteSelectedCloudEntry = async () => {
    if (!selectedRemote || !selectedCloudStorageEntry) return;
    if (cloudDeleteArmedPath !== selectedCloudStorageEntry.path) {
      setCloudDeleteArmedPath(selectedCloudStorageEntry.path);
      setCloudActionStatus('idle');
      setCloudActionMessage(`Bấm Xác nhận xóa lần nữa để xóa ${selectedCloudStorageEntry.path}.`);
      return;
    }
    await runCloudStorageAction(
      () => window.encoder.deleteCloudStorageEntry({
        remoteName: selectedRemote,
        path: selectedCloudStorageEntry.path,
        isDirectory: selectedCloudStorageEntry.isDirectory,
      }),
      { refresh: true, clearSelection: true },
    );
  };

  const addEncodeInputs = useCallback(async (filePaths: string[]) => {
    if (isBusy) return;
    const activePaths = new Set(
      encodeQueueRef.current
        .filter((item) => item.status === 'queued' || item.status === 'running')
        .map((item) => item.media.path),
    );
    const uniquePaths = [...new Set(filePaths.filter(Boolean))].filter((filePath) => !activePaths.has(filePath));
    if (uniquePaths.length === 0) return;

    setStatus('probing');
    setErrorMessage('');
    setProgress(null);
    setLogs([]);
    setSubtitleExportStatus('idle');
    setSubtitleExportMessage('');
    setSubtitleOutputDirectory('');

    const results = await Promise.allSettled(uniquePaths.map((filePath) => window.encoder.probeMedia(filePath)));
    const mediaItems = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failedCount = results.length - mediaItems.length;
    if (mediaItems.length === 0) {
      const firstError = results.find((result) => result.status === 'rejected');
      setStatus('failed');
      setErrorMessage(firstError?.status === 'rejected' ? cleanError(firstError.reason) : 'Không thể đọc các video đã chọn.');
      return;
    }

    const queueItems: EncodeQueueItem[] = mediaItems.map((info) => ({
      id: createQueueId('encode'),
      media: info,
      status: 'queued',
      config: null,
      autoUploadTarget: null,
      autoUploadOnzload: false,
      jobId: null,
      outputPath: '',
      progress: null,
      videoEncoderLabel: '',
      error: '',
    }));
    replaceEncodeQueue((current) => [...current, ...queueItems]);
    const firstMedia = mediaItems[0];
    setMedia(firstMedia);
    setSelectedSubtitleIndices(firstMedia.subtitleTracks.map((track) => track.streamIndex));
    setPresetId((current) =>
      current === 'copy-source' && mediaItems.some((info) => info.videoCodec.toLowerCase() !== 'h264')
        ? 'adaptive-1080'
        : current,
    );
    setOutputDirectory((current) => current || directoryOf(firstMedia.path));
    setStatus('ready');
    if (failedCount > 0) setErrorMessage(`Đã bỏ qua ${failedCount} video không đọc được.`);
  }, [isBusy, replaceEncodeQueue]);

  const loadInput = useCallback(async (filePath: string) => {
    if (filePath) await addEncodeInputs([filePath]);
  }, [addEncodeInputs]);

  const enqueueUploadPaths = useCallback((
    sourcePaths: string[],
    target: Omit<RcloneUploadConfig, 'sourcePath'> | null = null,
    temporarySource = false,
    prioritize = false,
    stopQueueAfterComplete = false,
  ) => {
    const activePaths = new Set(
      uploadQueueRef.current
        .filter((item) => item.status === 'queued' || item.status === 'running')
        .map((item) => item.sourcePath),
    );
    const uniquePaths = [...new Set(sourcePaths.filter(Boolean))].filter((sourcePath) => !activePaths.has(sourcePath));
    if (uniquePaths.length === 0) return 0;
    const queueItems: UploadQueueItem[] = uniquePaths.map((sourcePath, index) => ({
      id: createQueueId('upload'),
      sourcePath,
      status: 'queued',
      config: target ? { sourcePath, ...target } : null,
      jobId: null,
      destination: '',
      publicUrl: '',
      progress: null,
      error: '',
      temporarySource,
      stopQueueAfterComplete: stopQueueAfterComplete && index === uniquePaths.length - 1,
    }));
    replaceUploadQueue((current) => prioritize ? [...queueItems, ...current] : [...current, ...queueItems]);
    setLocalHlsPath(uniquePaths[0]);
    return queueItems.length;
  }, [replaceUploadQueue]);

  const enqueueOnzloadPath = useCallback((
    sourcePath: string,
    originalName = '',
    itemSegmentDuration = segmentDuration,
  ) => {
    if (!sourcePath) return false;
    const duplicate = onzloadQueueRef.current.some(
      (item) => item.sourcePath === sourcePath && (item.status === 'queued' || item.status === 'running'),
    );
    if (duplicate) return false;
    const item: OnzloadQueueItem = {
      id: createQueueId('onzload'),
      sourcePath,
      originalName: originalName || baseNameOf(sourcePath).replace(/-hls(?:-\d+)?$/i, ''),
      segmentDuration: itemSegmentDuration,
      idempotencyKey: `desktop-${globalThis.crypto.randomUUID()}`,
      status: 'queued',
      jobId: null,
      uploadId: '',
      destination: '',
      embedUrl: '',
      progress: null,
      error: '',
    };
    replaceOnzloadQueue((items) => [...items, item]);
    return true;
  }, [replaceOnzloadQueue, segmentDuration]);

  function finishRemoteHlsBatch(): void {
    const batch = remoteHlsBatchRef.current;
    if (!batch) return;
    const summary = remoteHlsBatchSummaryRef.current;
    setUploadQueueRunning(false);
    setRemoteHlsStatus(summary.downloaded > 0 ? 'success' : 'failed');
    setRemoteHlsMessage(
      summary.downloaded === 0
        ? `Không tải được link HLS nào. ${batch.failures[0] ?? ''}`.trim()
        : `Đã upload ${summary.uploaded}/${summary.total} HLS lên storage${summary.failed > 0 ? ` · ${summary.failed} link nguồn lỗi` : ''}${summary.uploadFailed > 0 ? ` · ${summary.uploadFailed} upload lỗi` : ''}.`,
    );
    remoteHlsBatchRef.current = null;
    remoteHlsUploadTargetRef.current = null;
  }

  function settleRemoteHlsUploadQueue(): void {
    const batch = remoteHlsBatchRef.current;
    if (!batch) return;
    const batchPaths = new Set(batch.outputPaths);
    const hasPendingBatchUpload = uploadQueueRef.current.some(
      (item) => batchPaths.has(item.sourcePath) && (item.status === 'queued' || item.status === 'running'),
    );
    if (hasPendingBatchUpload) return;
    if (!batch.downloadsComplete) {
      // Do not let unrelated manual queue items run while waiting for the next URL in this batch.
      setUploadQueueRunning(false);
      return;
    }
    finishRemoteHlsBatch();
  }

  async function startRemoteHlsBatchItem(): Promise<void> {
    const batch = remoteHlsBatchRef.current;
    if (!batch) return;
    const position = batch.index + 1;
    const folderName = batch.folderPrefix
      ? batch.urls.length > 1
        ? `${batch.folderPrefix}-${String(position).padStart(2, '0')}`
        : batch.folderPrefix
      : undefined;
    setRemoteHlsStatus('downloading');
    setRemoteHlsProgress(null);
    setRemoteHlsMessage(`Đang tải link ${position}/${batch.urls.length}…`);
    try {
      const result = await window.encoder.startRemoteHlsDownload({
        url: batch.urls[batch.index],
        folderName,
      });
      setRemoteHlsJobId(result.jobId);
    } catch (error) {
      advanceRemoteHlsBatch(undefined, cleanError(error));
    }
  }

  function advanceRemoteHlsBatch(result?: { outputPath: string; fileCount: number; totalBytes: number }, errorMessage = ''): void {
    const batch = remoteHlsBatchRef.current;
    if (!batch) return;
    if (result) {
      batch.outputPaths.push(result.outputPath);
      setRemoteHlsBatchSourcePaths([...batch.outputPaths]);
      enqueueUploadPaths([result.outputPath], batch.target, true, true, true);
      setUploadQueueRunning(true);
    }
    if (errorMessage) batch.failures.push(`Link ${batch.index + 1}: ${errorMessage}`);
    const processed = batch.index + 1;
    const batchProgress = {
      total: batch.urls.length,
      processed,
      downloaded: batch.outputPaths.length,
      failed: batch.failures.length,
      uploaded: remoteHlsBatchSummaryRef.current.uploaded,
      uploadFailed: remoteHlsBatchSummaryRef.current.uploadFailed,
    };
    remoteHlsBatchSummaryRef.current = batchProgress;
    setRemoteHlsBatchProgress(batchProgress);
    setRemoteHlsJobId(null);

    if (processed < batch.urls.length) {
      batch.index += 1;
      void startRemoteHlsBatchItem();
      return;
    }

    batch.downloadsComplete = true;
    setRemoteHlsUrl('');
    if (batch.outputPaths.length === 0) {
      finishRemoteHlsBatch();
      return;
    }

    setRemoteHlsStatus('success');
    setRemoteHlsMessage(
      `Đã tải ${batch.outputPaths.length}/${batch.urls.length} link${batch.failures.length > 0 ? ` · ${batch.failures.length} link lỗi` : ''}. Đang hoàn tất upload lên storage…`,
    );
    settleRemoteHlsUploadQueue();
  }

  useEffect(() => {
    return window.encoder.onEncodeEvent((event: EncodeEvent) => {
      const queueItemId = activeEncodeQueueItemIdRef.current;
      if (event.type === 'started') {
        setJobId(event.jobId);
        setOutputPath(event.outputPath);
        setActiveVideoEncoderLabel(event.videoEncoderLabel);
        setStatus('encoding');
        if (queueItemId) {
          replaceEncodeQueue((items) => updateQueueItem(items, queueItemId, {
            jobId: event.jobId,
            outputPath: event.outputPath,
            videoEncoderLabel: event.videoEncoderLabel,
            status: 'running',
          }));
        }
        return;
      }
      if (event.type === 'progress') {
        setProgress(event.progress);
        if (queueItemId) {
          replaceEncodeQueue((items) => updateQueueItem(items, queueItemId, { progress: event.progress }));
        }
        return;
      }
      if (event.type === 'log') {
        setLogs((current) => [...current.slice(-199), event.line]);
        return;
      }
      if (event.type === 'completed') {
        const queueItem = queueItemId ? encodeQueueRef.current.find((item) => item.id === queueItemId) : null;
        const completedProgress = queueItem?.progress
          ? { ...queueItem.progress, percent: 100, encodedSeconds: queueItem.progress.durationSeconds, etaSeconds: 0, statusText: 'Đã hoàn tất' }
          : null;
        setProgress(completedProgress);
        setOutputPath(event.outputPath);
        setLocalHlsPath(event.outputPath);
        setStatus('completed');
        if (queueItemId) {
          replaceEncodeQueue((items) => updateQueueItem(items, queueItemId, {
            status: 'completed',
            outputPath: event.outputPath,
            progress: completedProgress,
          }));
        }
        if (queueItem?.autoUploadTarget) {
          enqueueUploadPaths([event.outputPath], queueItem.autoUploadTarget);
          setUploadQueueRunning(true);
        }
        if (queueItem?.autoUploadOnzload) {
          enqueueOnzloadPath(event.outputPath, queueItem.media.name, queueItem.config?.segmentDuration ?? 4);
          setOnzloadQueueRunning(true);
        }
        setActiveEncodeQueueItem(null);
        return;
      }
      if (event.type === 'cancelled') {
        setStatus('cancelled');
        if (queueItemId) {
          replaceEncodeQueue((items) => updateQueueItem(items, queueItemId, { status: 'cancelled' }));
        }
        setActiveEncodeQueueItem(null);
        return;
      }
      if (event.type === 'failed') {
        setErrorMessage(event.message);
        setStatus('failed');
        if (queueItemId) {
          replaceEncodeQueue((items) => updateQueueItem(items, queueItemId, {
            status: 'failed',
            error: event.message,
          }));
        }
        setActiveEncodeQueueItem(null);
      }
    });
  }, [enqueueOnzloadPath, enqueueUploadPaths, replaceEncodeQueue, setActiveEncodeQueueItem]);

  useEffect(() => {
    void refreshRclone();
  }, [refreshRclone]);

  useEffect(() => {
    void refreshOnzload();
  }, [refreshOnzload]);

  useEffect(() => {
    window.localStorage.setItem('dao-encoding:onzload-url', onzloadBaseUrl);
  }, [onzloadBaseUrl]);

  useEffect(() => {
    window.localStorage.setItem('dao-encoding:onzload-auto', String(uploadAfterEncodeOnzload));
  }, [uploadAfterEncodeOnzload]);

  useEffect(() => {
    void refreshHardwareAcceleration();
  }, [refreshHardwareAcceleration]);

  useEffect(() => {
    if (activeTab !== 'storage' || !selectedRemote || cloudStorageLoadedRemote === selectedRemote) return;
    void loadCloudStorage(cloudStoragePath);
  }, [activeTab, cloudStorageLoadedRemote, cloudStoragePath, loadCloudStorage, selectedRemote]);

  useEffect(() => {
    return window.encoder.onRcloneUploadEvent((event: RcloneUploadEvent) => {
      const queueItemId = activeUploadQueueItemIdRef.current;
      if (event.type === 'started') {
        setUploadJobId(event.jobId);
        setUploadDestination(event.destination);
        setUploadPublicUrl('');
        setUploadStatus('uploading');
        if (queueItemId) {
          replaceUploadQueue((items) => updateQueueItem(items, queueItemId, {
            jobId: event.jobId,
            destination: event.destination,
            status: 'running',
          }));
        }
        return;
      }
      if (event.type === 'progress') {
        setUploadProgress(event.progress);
        if (queueItemId) {
          replaceUploadQueue((items) => updateQueueItem(items, queueItemId, { progress: event.progress }));
        }
        return;
      }
      if (event.type === 'log') {
        setUploadLogs((current) => [...current.slice(-199), event.line]);
        return;
      }
      if (event.type === 'completed') {
        const queueItem = queueItemId ? uploadQueueRef.current.find((item) => item.id === queueItemId) : null;
        const publicUrl = queueItem?.config ? buildPublicHlsUrl(queueItem.config) : '';
        const completedItemProgress = queueItem?.progress ?? initialUploadProgress();
        if (queueItem?.temporarySource) {
          const nextSummary = {
            ...remoteHlsBatchSummaryRef.current,
            uploaded: remoteHlsBatchSummaryRef.current.uploaded + 1,
          };
          remoteHlsBatchSummaryRef.current = nextSummary;
          setRemoteHlsBatchProgress(nextSummary);
          setRemoteHlsMessage(
            publicUrl
              ? `Đã upload ${nextSummary.uploaded}/${nextSummary.downloaded} HLS · URL mới đã sẵn sàng để sao chép.`
              : `Đã upload ${nextSummary.uploaded}/${nextSummary.downloaded} HLS · chưa cấu hình URL public/CDN.`,
          );
        }
        setUploadDestination(event.destination);
        setUploadPublicUrl(publicUrl);
        setUploadStatus('success');
        setUploadProgress((current) => ({
          ...(current ?? initialUploadProgress()),
          percent: 100,
          etaSeconds: 0,
          files: current?.totalFiles || current?.files || 0,
        }));
        if (queueItemId) {
          replaceUploadQueue((items) => updateQueueItem(items, queueItemId, {
            status: 'completed',
            destination: event.destination,
            publicUrl,
            progress: {
              ...completedItemProgress,
              percent: 100,
              etaSeconds: 0,
              files: completedItemProgress.totalFiles || completedItemProgress.files,
            },
          }));
        }
        if (queueItem?.temporarySource) {
          void window.encoder.cleanupRemoteHlsDownload(queueItem.sourcePath).catch(() => undefined);
        }
        if (queueItem?.stopQueueAfterComplete) {
          settleRemoteHlsUploadQueue();
        }
        setActiveUploadQueueItem(null);
        return;
      }
      if (event.type === 'cancelled') {
        setUploadStatus('cancelled');
        if (queueItemId) {
          replaceUploadQueue((items) => updateQueueItem(items, queueItemId, { status: 'cancelled' }));
        }
        const queueItem = queueItemId ? uploadQueueRef.current.find((item) => item.id === queueItemId) : null;
        if (queueItem?.temporarySource) {
          void window.encoder.cleanupRemoteHlsDownload(queueItem.sourcePath).catch(() => undefined);
        }
        if (queueItem?.stopQueueAfterComplete) {
          setUploadQueueRunning(false);
          setRemoteHlsMessage('Đã dừng upload URL HLS.');
          const batch = remoteHlsBatchRef.current;
          if (batch?.downloadsComplete) {
            const batchPaths = new Set(batch.outputPaths);
            replaceUploadQueue((items) => items.map((item) => (
              batchPaths.has(item.sourcePath) && item.status === 'queued'
                ? { ...item, status: 'cancelled' as const }
                : item
            )));
            for (const item of uploadQueueRef.current) {
              if (batchPaths.has(item.sourcePath) && item.status === 'cancelled') {
                void window.encoder.cleanupRemoteHlsDownload(item.sourcePath).catch(() => undefined);
              }
            }
            remoteHlsBatchRef.current = null;
            remoteHlsUploadTargetRef.current = null;
          }
        }
        setActiveUploadQueueItem(null);
        return;
      }
      if (event.type === 'failed') {
        setUploadError(event.message);
        setUploadStatus('failed');
        if (queueItemId) {
          replaceUploadQueue((items) => updateQueueItem(items, queueItemId, {
            status: 'failed',
            error: event.message,
          }));
        }
        const queueItem = queueItemId ? uploadQueueRef.current.find((item) => item.id === queueItemId) : null;
        if (queueItem?.temporarySource) {
          const nextSummary = {
            ...remoteHlsBatchSummaryRef.current,
            uploadFailed: remoteHlsBatchSummaryRef.current.uploadFailed + 1,
          };
          remoteHlsBatchSummaryRef.current = nextSummary;
          setRemoteHlsBatchProgress(nextSummary);
        }
        if (queueItem?.stopQueueAfterComplete) {
          settleRemoteHlsUploadQueue();
        }
        setActiveUploadQueueItem(null);
      }
    });
  }, [replaceUploadQueue, setActiveUploadQueueItem]);

  useEffect(() => {
    return window.encoder.onOnzloadUploadEvent((event: OnzloadUploadEvent) => {
      const queueItemId = activeOnzloadQueueItemIdRef.current;
      if (event.type === 'started') {
        if (queueItemId) {
          replaceOnzloadQueue((items) => updateQueueItem(items, queueItemId, {
            status: 'running',
            jobId: event.jobId,
            uploadId: event.uploadId,
            destination: event.destination,
          }));
        }
        return;
      }
      if (event.type === 'progress') {
        if (queueItemId) {
          replaceOnzloadQueue((items) => updateQueueItem(items, queueItemId, { progress: event.progress }));
        }
        return;
      }
      if (event.type === 'log') {
        setOnzloadLogs((items) => [...items.slice(-99), event.line]);
        return;
      }
      if (event.type === 'completed') {
        if (queueItemId) {
          replaceOnzloadQueue((items) => updateQueueItem(items, queueItemId, (item) => ({
            ...item,
            status: 'completed',
            uploadId: event.result.uploadId,
            embedUrl: event.result.embedUrl,
            progress: { ...(item.progress ?? initialUploadProgress()), percent: 100, etaSeconds: 0 },
          })));
        }
        setActiveOnzloadQueueItem(null);
        return;
      }
      if (event.type === 'cancelled') {
        if (queueItemId) {
          replaceOnzloadQueue((items) => updateQueueItem(items, queueItemId, { status: 'cancelled' }));
        }
        setActiveOnzloadQueueItem(null);
        return;
      }
      if (queueItemId) {
        replaceOnzloadQueue((items) => updateQueueItem(items, queueItemId, {
          status: 'failed',
          error: event.message,
        }));
      }
      setActiveOnzloadQueueItem(null);
    });
  }, [replaceOnzloadQueue, setActiveOnzloadQueueItem]);

  useEffect(() => {
    return window.encoder.onRemoteHlsDownloadEvent((event: RemoteHlsDownloadEvent) => {
      if (event.type === 'started') {
        setRemoteHlsJobId(event.jobId);
        setRemoteHlsStatus('downloading');
        return;
      }
      if (event.type === 'progress') {
        setRemoteHlsProgress(event.progress);
        const batch = remoteHlsBatchRef.current;
        setRemoteHlsMessage(batch
          ? `Link ${batch.index + 1}/${batch.urls.length} · ${event.progress.statusText}`
          : event.progress.statusText);
        return;
      }
      if (event.type === 'completed') {
        advanceRemoteHlsBatch(event.result);
        return;
      }
      if (event.type === 'cancelled') {
        const batch = remoteHlsBatchRef.current;
        const completedPaths = batch?.outputPaths ?? [];
        const batchPaths = new Set(completedPaths);
        const runningPaths = new Set(
          uploadQueueRef.current
            .filter((item) => batchPaths.has(item.sourcePath) && item.status === 'running')
            .map((item) => item.sourcePath),
        );
        replaceUploadQueue((items) => items.map((item) => (
          batchPaths.has(item.sourcePath) && item.status === 'queued'
            ? { ...item, status: 'cancelled' as const }
            : item
        )));
        for (const outputPath of completedPaths) {
          if (!runningPaths.has(outputPath)) void window.encoder.cleanupRemoteHlsDownload(outputPath).catch(() => undefined);
        }
        remoteHlsBatchRef.current = null;
        setUploadQueueRunning(false);
        setRemoteHlsStatus('cancelled');
        setRemoteHlsMessage('Đã hủy batch URL HLS. Upload đang chạy cũng được dừng và dữ liệu tạm được dọn an toàn.');
        setRemoteHlsJobId(null);
        remoteHlsUploadTargetRef.current = null;
        return;
      }
      if (event.type === 'failed') {
        advanceRemoteHlsBatch(undefined, event.message);
      }
    });
  }, [enqueueUploadPaths, replaceUploadQueue]);

  useEffect(() => {
    if (showLogs) scrollLogContainerToEnd(logOutputRef.current);
  }, [logs, showLogs, uploadLogs]);

  const chooseInput = async () => {
    const filePaths = await window.encoder.selectInputs();
    if (filePaths.length > 0) await addEncodeInputs(filePaths);
  };

  const chooseOutput = async () => {
    const directory = await window.encoder.selectOutput();
    if (directory) setOutputDirectory(directory);
  };

  const chooseLogo = async () => {
    if (isBusy) return;
    const logoPath = await window.encoder.selectLogo();
    if (!logoPath) return;
    setLogoOverlay((current) => ({ ...current, enabled: true, path: logoPath }));
    if (presetId === 'copy-source') setPresetId('single-source');
  };

  const toggleLogoOverlay = async (enabled: boolean) => {
    if (!enabled) {
      setLogoOverlay((current) => ({ ...current, enabled: false }));
      return;
    }
    if (!logoOverlay.path) {
      await chooseLogo();
      return;
    }
    setLogoOverlay((current) => ({ ...current, enabled: true }));
    if (presetId === 'copy-source') setPresetId('single-source');
  };

  const chooseHlsFolder = async () => {
    if (isBusy) return;
    const directories = await window.encoder.selectHlsFolders();
    if (directories.length === 0) return;
    enqueueUploadPaths(directories);
    setUploadStatus('idle');
    setUploadProgress(null);
    setUploadDestination('');
    setUploadPublicUrl('');
    setUploadError('');
    setUploadLogs([]);
  };

  const startRemoteHlsDownload = useCallback(async () => {
    if (!remoteHlsUrlIsValid || parsedRemoteHlsUrls.length === 0 || isBusy || !uploadConfigured || publicBaseUrlError) return;
    const target: Omit<RcloneUploadConfig, 'sourcePath'> = {
      remoteName: selectedRemote,
      destinationPath: remoteDestinationPath,
      publicBaseUrl: normalizedPublicBaseUrl || undefined,
      performanceId: uploadPerformanceId,
    };
    const initialBatchProgress = {
      total: parsedRemoteHlsUrls.length,
      processed: 0,
      downloaded: 0,
      failed: 0,
      uploaded: 0,
      uploadFailed: 0,
    };
    remoteHlsUploadTargetRef.current = target;
    remoteHlsBatchRef.current = {
      urls: parsedRemoteHlsUrls,
      index: 0,
      outputPaths: [],
      failures: [],
      folderPrefix: remoteHlsFolderName.trim(),
      target,
      downloadsComplete: false,
    };
    setRemoteHlsBatchSourcePaths([]);
    remoteHlsBatchSummaryRef.current = initialBatchProgress;
    setRemoteHlsBatchProgress(initialBatchProgress);
    setRemoteHlsStatus('downloading');
    setRemoteHlsProgress(null);
    setRemoteHlsMessage(`Đang chuẩn bị tải ${parsedRemoteHlsUrls.length} link HLS…`);
    setUploadStatus('idle');
    setUploadProgress(null);
    setUploadDestination('');
    setUploadPublicUrl('');
    setUploadError('');
    setUploadLogs([]);
    await startRemoteHlsBatchItem();
  }, [
    isBusy,
    normalizedPublicBaseUrl,
    parsedRemoteHlsUrls,
    publicBaseUrlError,
    remoteDestinationPath,
    remoteHlsFolderName,
    remoteHlsUrlIsValid,
    selectedRemote,
    uploadConfigured,
    uploadPerformanceId,
  ]);

  const cancelRemoteHlsDownload = async () => {
    setUploadQueueRunning(false);
    await Promise.all([
      remoteHlsJobId ? window.encoder.cancelRemoteHlsDownload(remoteHlsJobId) : Promise.resolve(false),
      uploadJobId ? window.encoder.cancelRcloneUpload(uploadJobId) : Promise.resolve(false),
    ]);
  };

  const saveRemote = async () => {
    const config: RcloneRemoteConfig = {
      name: remoteName,
      provider: remoteProvider,
      accessKeyId: remoteAccessKeyId,
      secretAccessKey: remoteSecretAccessKey,
      endpoint: remoteEndpoint,
      region: remoteRegion,
    };
    setRemoteSaveStatus('saving');
    setRemoteSaveMessage('Đang bảo vệ secret và lưu rclone.conf…');
    try {
      const result = await window.encoder.saveRcloneRemote(config);
      setRemoteSaveStatus('success');
      setRemoteSaveMessage(result.message);
      setRemoteSecretAccessKey('');
      await refreshRclone(result.remote.name);
    } catch (error) {
      setRemoteSaveStatus('failed');
      setRemoteSaveMessage(cleanError(error));
    }
  };

  const toggleSubtitleTrack = (streamIndex: number) => {
    setSelectedSubtitleIndices((current) =>
      current.includes(streamIndex)
        ? current.filter((index) => index !== streamIndex)
        : [...current, streamIndex],
    );
    setSubtitleExportStatus('idle');
    setSubtitleExportMessage('');
  };

  const toggleAllSubtitles = () => {
    if (!media) return;
    const allSelected = selectedSubtitleIndices.length === media.subtitleTracks.length;
    setSelectedSubtitleIndices(allSelected ? [] : media.subtitleTracks.map((track) => track.streamIndex));
    setSubtitleExportStatus('idle');
    setSubtitleExportMessage('');
  };

  const exportSelectedSubtitles = async () => {
    if (!media || selectedSubtitleIndices.length === 0) return;
    const directory = await window.encoder.selectSubtitleOutput();
    if (!directory) return;

    setSubtitleExportStatus('exporting');
    setSubtitleExportMessage('Đang xuất subtitle bằng FFmpeg…');
    try {
      const result = await window.encoder.exportSubtitles({
        inputPath: media.path,
        outputDirectory: directory,
        streamIndices: selectedSubtitleIndices,
      });
      setSubtitleOutputDirectory(result.outputDirectory);
      setSubtitleExportStatus('success');
      setSubtitleExportMessage(`Đã xuất ${result.files.length} file: ${result.files.map((file) => file.fileName).join(', ')}`);
    } catch (error) {
      setSubtitleExportStatus('failed');
      setSubtitleExportMessage(cleanError(error));
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    dropDepth.current = 0;
    setIsDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length === 0) return;
    const accepted = files.filter((file) => ACCEPTED_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() ?? ''));
    if (accepted.length === 0) {
      setErrorMessage('Định dạng này chưa được hỗ trợ. Hãy chọn MP4, MKV, MOV, AVI, WebM hoặc MPEG-TS.');
      setStatus('failed');
      return;
    }
    await addEncodeInputs(accepted.map((file) => window.encoder.getPathForFile(file)));
  };

  const startEncode = () => {
    if (!canStart || !outputDirectory) return;
    const autoUploadTarget = uploadAfterEncode && uploadConfigured
      ? {
        remoteName: selectedRemote,
        destinationPath: remoteDestinationPath,
        publicBaseUrl: normalizedPublicBaseUrl || undefined,
        performanceId: uploadPerformanceId,
      }
      : null;
    replaceEncodeQueue((items) => items.map((item) => {
      if (item.status !== 'queued') return item;
      const itemPresetId = uploadAfterEncodeOnzload && presetId === 'copy-source'
        ? 'adaptive-1080'
        : presetId === 'copy-source' && item.media.videoCodec.toLowerCase() !== 'h264'
        ? 'adaptive-1080'
        : presetId;
      return {
        ...item,
        config: {
          inputPath: item.media.path,
          outputDirectory,
          presetId: itemPresetId,
          speedId,
          segmentDuration,
          videoEncoderId,
          advanced: uploadAfterEncodeOnzload
            ? { ...advancedSettings, audioChannels: 2, audioSampleRate: 48_000 }
            : { ...advancedSettings },
          logoOverlay: { ...logoOverlay },
        },
        autoUploadTarget,
        autoUploadOnzload: uploadAfterEncodeOnzload,
        error: '',
      };
    }));
    setErrorMessage('');
    setLogs([]);
    setEncodeQueueRunning(true);
  };

  const cancelEncode = async () => {
    setEncodeQueueRunning(false);
    if (jobId) await window.encoder.cancelEncode(jobId);
  };

  const testUploadTarget = async () => {
    if (!selectedRemote) return;
    setTargetCheckStatus('checking');
    setTargetCheckMessage('Đang kiểm tra quyền truy cập…');
    try {
      const result = await window.encoder.testRcloneTarget({
        remoteName: selectedRemote,
        destinationPath: remoteDestinationPath,
      });
      setTargetCheckStatus('success');
      setTargetCheckMessage(result.message);
    } catch (error) {
      setTargetCheckStatus('failed');
      setTargetCheckMessage(cleanError(error));
    }
  };

  const startRcloneUpload = () => {
    if (!canUpload) return;
    replaceUploadQueue((items) => items.map((item) => {
      if (item.status !== 'queued' || item.config) return item;
      return {
        ...item,
        config: {
          sourcePath: item.sourcePath,
          remoteName: selectedRemote,
          destinationPath: remoteDestinationPath,
          publicBaseUrl: normalizedPublicBaseUrl || undefined,
          performanceId: uploadPerformanceId,
        },
        error: '',
      };
    }));
    setUploadError('');
    setUploadLogs([]);
    setUploadQueueRunning(true);
  };

  const cancelRcloneUpload = async () => {
    setUploadQueueRunning(false);
    if (uploadJobId) await window.encoder.cancelRcloneUpload(uploadJobId);
  };

  const removeEncodeQueueItem = (id: string) => {
    replaceEncodeQueue((items) => removeQueueItem(items, id));
  };

  const retryEncodeQueueItem = (id: string) => {
    replaceEncodeQueue((items) => updateQueueItem(items, id, {
      status: 'queued',
      config: null,
      autoUploadTarget: null,
      autoUploadOnzload: false,
      jobId: null,
      outputPath: '',
      progress: null,
      videoEncoderLabel: '',
      error: '',
    }));
    setStatus('ready');
  };

  const removeUploadQueueItem = (id: string) => {
    const item = uploadQueueRef.current.find((candidate) => candidate.id === id);
    if (item?.temporarySource) {
      void window.encoder.cleanupRemoteHlsDownload(item.sourcePath).catch(() => undefined);
    }
    replaceUploadQueue((items) => removeQueueItem(items, id));
  };

  const retryUploadQueueItem = (id: string) => {
    replaceUploadQueue((items) => updateQueueItem(items, id, {
      status: 'queued',
      jobId: null,
      destination: '',
      publicUrl: '',
      progress: null,
      error: '',
      stopQueueAfterComplete: false,
    }));
    setUploadStatus('idle');
  };

  const removeOnzloadQueueItem = (id: string) => {
    replaceOnzloadQueue((items) => removeQueueItem(items, id));
  };

  const retryOnzloadQueueItem = (id: string) => {
    replaceOnzloadQueue((items) => updateQueueItem(items, id, {
      status: 'queued',
      jobId: null,
      uploadId: '',
      destination: '',
      embedUrl: '',
      progress: null,
      error: '',
    }));
    setOnzloadQueueRunning(true);
  };

  const uploadCurrentFolderToOnzload = () => {
    if (!onzloadSession.connected || !localHlsPath) return;
    enqueueOnzloadPath(localHlsPath);
    setOnzloadQueueRunning(true);
  };

  const cancelOnzloadUpload = async () => {
    setOnzloadQueueRunning(false);
    const item = activeOnzloadQueueItemIdRef.current
      ? onzloadQueueRef.current.find((candidate) => candidate.id === activeOnzloadQueueItemIdRef.current)
      : null;
    if (item?.jobId) await window.encoder.cancelOnzloadUpload(item.jobId);
  };

  useEffect(() => {
    if (!queueReadiness.encode) return;

    const nextItem = nextQueuedItem(encodeQueue);
    if (!nextItem) {
      setEncodeQueueRunning(false);
      return;
    }
    if (!nextItem.config) {
      replaceEncodeQueue((items) => updateQueueItem(items, nextItem.id, {
        status: 'failed',
        error: 'Item chưa có cấu hình encode.',
      }));
      return;
    }

    const itemProgress = initialEncodeProgress(nextItem.media.durationSeconds);
    setActiveEncodeQueueItem(nextItem.id);
    replaceEncodeQueue((items) => updateQueueItem(items, nextItem.id, {
      status: 'running',
      progress: itemProgress,
      error: '',
    }));
    setMedia(nextItem.media);
    setSelectedSubtitleIndices(nextItem.media.subtitleTracks.map((track) => track.streamIndex));
    setStatus('encoding');
    setProgress(itemProgress);
    setJobId(null);
    setOutputPath('');
    setActiveVideoEncoderLabel('');
    setErrorMessage('');
    setLogs([]);

    void window.encoder.startEncode(nextItem.config).then((result) => {
      setJobId(result.jobId);
      setOutputPath(result.outputPath);
      setActiveVideoEncoderLabel(result.videoEncoderLabel);
      replaceEncodeQueue((items) => updateQueueItem(items, nextItem.id, {
        jobId: result.jobId,
        outputPath: result.outputPath,
        videoEncoderLabel: result.videoEncoderLabel,
      }));
    }).catch((error) => {
      const message = cleanError(error);
      setStatus('failed');
      setErrorMessage(message);
      replaceEncodeQueue((items) => updateQueueItem(items, nextItem.id, {
        status: 'failed',
        error: message,
      }));
      setActiveEncodeQueueItem(null);
    });
  }, [
    encodeQueue,
    queueReadiness.encode,
    replaceEncodeQueue,
    setActiveEncodeQueueItem,
  ]);

  useEffect(() => {
    if (!queueReadiness.upload || activeOnzloadQueueItemIdRef.current) return;

    const nextItem = nextQueuedItem(uploadQueue);
    if (!nextItem) {
      setUploadQueueRunning(false);
      return;
    }
    if (!nextItem.config) {
      replaceUploadQueue((items) => updateQueueItem(items, nextItem.id, {
        status: 'failed',
        error: 'Item chưa có remote hoặc đường dẫn đích.',
      }));
      return;
    }

    const itemProgress = initialUploadProgress();
    setActiveUploadQueueItem(nextItem.id);
    replaceUploadQueue((items) => updateQueueItem(items, nextItem.id, {
      status: 'running',
      progress: itemProgress,
      error: '',
    }));
    setLocalHlsPath(nextItem.sourcePath);
    setUploadStatus('uploading');
    setUploadProgress(itemProgress);
    setUploadJobId(null);
    setUploadDestination('');
    setUploadPublicUrl('');
    setUploadError('');
    setUploadLogs([]);

    void window.encoder.startRcloneUpload(nextItem.config).then((result) => {
      setUploadJobId(result.jobId);
      setUploadDestination(result.destination);
      replaceUploadQueue((items) => updateQueueItem(items, nextItem.id, {
        jobId: result.jobId,
        destination: result.destination,
      }));
    }).catch((error) => {
      const message = cleanError(error);
      setUploadStatus('failed');
      setUploadError(message);
      replaceUploadQueue((items) => updateQueueItem(items, nextItem.id, {
        status: 'failed',
        error: message,
      }));
      if (nextItem.temporarySource) {
        const nextSummary = {
          ...remoteHlsBatchSummaryRef.current,
          uploadFailed: remoteHlsBatchSummaryRef.current.uploadFailed + 1,
        };
        remoteHlsBatchSummaryRef.current = nextSummary;
        setRemoteHlsBatchProgress(nextSummary);
      }
      if (nextItem.stopQueueAfterComplete) {
        settleRemoteHlsUploadQueue();
      }
      setActiveUploadQueueItem(null);
    });
  }, [
    queueReadiness.upload,
    replaceUploadQueue,
    setActiveUploadQueueItem,
    uploadQueue,
  ]);

  useEffect(() => {
    if (
      !onzloadQueueRunning ||
      activeOnzloadQueueItemId ||
      activeUploadQueueItemIdRef.current ||
      isUploading ||
      isSubtitleExporting
    ) return;
    const nextItem = nextQueuedItem(onzloadQueue);
    if (!nextItem) {
      setOnzloadQueueRunning(false);
      return;
    }
    if (!onzloadSession.connected) {
      replaceOnzloadQueue((items) => updateQueueItem(items, nextItem.id, {
        status: 'failed',
        error: 'Phiên OnzLoad chưa được liên kết hoặc đã hết hạn.',
      }));
      return;
    }

    const itemProgress = initialUploadProgress();
    setActiveOnzloadQueueItem(nextItem.id);
    replaceOnzloadQueue((items) => updateQueueItem(items, nextItem.id, {
      status: 'running',
      progress: itemProgress,
      error: '',
    }));
    setOnzloadLogs([]);
    void window.encoder.startOnzloadUpload({
      sourcePath: nextItem.sourcePath,
      originalName: nextItem.originalName,
      idempotencyKey: nextItem.idempotencyKey,
      segmentDuration: nextItem.segmentDuration,
      performanceId: uploadPerformanceId,
    }).then((result) => {
      replaceOnzloadQueue((items) => updateQueueItem(items, nextItem.id, { jobId: result.jobId }));
    }).catch((error) => {
      const message = cleanError(error);
      replaceOnzloadQueue((items) => updateQueueItem(items, nextItem.id, {
        status: 'failed',
        error: message,
      }));
      setActiveOnzloadQueueItem(null);
    });
  }, [
    activeOnzloadQueueItemId,
    isSubtitleExporting,
    isUploading,
    onzloadQueue,
    onzloadQueueRunning,
    onzloadSession.connected,
    replaceOnzloadQueue,
    setActiveOnzloadQueueItem,
    uploadPerformanceId,
  ]);

  const resetJob = () => {
    setStatus(media ? 'ready' : 'idle');
    setProgress(null);
    setJobId(null);
    setOutputPath('');
    setActiveVideoEncoderLabel('');
    setLogs([]);
    setErrorMessage('');
    setUploadStatus('idle');
    setUploadProgress(null);
    setUploadDestination('');
    setUploadPublicUrl('');
    setUploadError('');
  };

  const openUploadTab = (sourcePath = '') => {
    if (sourcePath) enqueueUploadPaths([sourcePath]);
    setActiveTab('upload');
  };

  const progressStyle = useMemo(
    () => ({ '--progress': `${progress?.percent ?? 0}%` }) as React.CSSProperties,
    [progress?.percent],
  );
  const remoteHlsHasPendingUploads = remoteHlsBatchProgress.downloaded > remoteHlsBatchProgress.uploaded + remoteHlsBatchProgress.uploadFailed;
  const remoteHlsWorkflowUploading = remoteHlsHasPendingUploads && (uploadQueueRunning || uploadStatus === 'uploading');
  const remoteHlsDownloadingAndUploading = isRemoteHlsDownloading && remoteHlsWorkflowUploading;
  const remoteHlsWorkflowSettled = remoteHlsStatus === 'success' && !uploadQueueRunning && !remoteHlsHasPendingUploads && ['success', 'failed'].includes(uploadStatus);
  const remoteHlsBatchErrorCount = remoteHlsBatchProgress.failed + remoteHlsBatchProgress.uploadFailed;
  const remoteHlsWorkflowPartial = remoteHlsWorkflowSettled && remoteHlsBatchProgress.uploaded > 0 && remoteHlsBatchErrorCount > 0;
  const remoteHlsWorkflowCompleted = remoteHlsWorkflowSettled && remoteHlsBatchErrorCount === 0;
  const remoteHlsWorkflowFailed = remoteHlsStatus === 'failed' || (remoteHlsWorkflowSettled && remoteHlsBatchProgress.uploaded === 0);
  const remoteHlsWorkflowCancelled = remoteHlsStatus === 'cancelled' || (remoteHlsStatus === 'success' && uploadStatus === 'cancelled');
  const remoteHlsWorkflowBusy = isRemoteHlsDownloading || remoteHlsWorkflowUploading;
  const remoteHlsWorkflowFinished = remoteHlsWorkflowCompleted || remoteHlsWorkflowPartial;
  const remoteHlsPublicResults = useMemo(() => {
    const batchOrder = new Map(remoteHlsBatchSourcePaths.map((sourcePath, index) => [sourcePath, index]));
    return uploadQueue
      .filter((item) => batchOrder.has(item.sourcePath) && Boolean(item.publicUrl))
      .sort((left, right) => (batchOrder.get(left.sourcePath) ?? 0) - (batchOrder.get(right.sourcePath) ?? 0));
  }, [remoteHlsBatchSourcePaths, uploadQueue]);
  const remoteHlsCurrentPosition = remoteHlsBatchProgress.total > 0
    ? Math.min(remoteHlsBatchProgress.processed + 1, remoteHlsBatchProgress.total)
    : 0;

  return (
    <div
      className="app-shell"
      onDragEnter={(event) => {
        event.preventDefault();
        if (activeTab !== 'encode') return;
        dropDepth.current += 1;
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (activeTab !== 'encode') return;
        dropDepth.current -= 1;
        if (dropDepth.current <= 0) setIsDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        if (activeTab === 'encode') void handleDrop(event);
        else event.preventDefault();
      }}
    >
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="brand-name">Đảo Phim Encoding</span>
          <span className="brand-pill">LOCAL ENCODER</span>
        </div>
        <nav className="app-tabs" aria-label="Chức năng chính">
          <button
            type="button"
            className={activeTab === 'encode' ? 'active' : ''}
            onClick={() => setActiveTab('encode')}
          >
            <Film size={13} /> Encode HLS
            {encodeQueueSummary.queued > 0 && <b className="tab-queue-count">{encodeQueueSummary.queued}</b>}
          </button>
          <button
            type="button"
            className={activeTab === 'upload' ? 'active' : ''}
            onClick={() => openUploadTab()}
          >
            <CloudUpload size={13} /> Upload R2 / S3
            {uploadQueueSummary.queued > 0 ? <b className="tab-queue-count">{uploadQueueSummary.queued}</b> : rcloneStatus.available && <i />}
          </button>
          <button
            type="button"
            className={activeTab === 'url-upload' ? 'active' : ''}
            onClick={() => setActiveTab('url-upload')}
          >
            <Link2 size={13} /> Upload URL HLS
            {isRemoteHlsDownloading && <LoaderCircle className="spin" size={11} />}
          </button>
          <button
            type="button"
            className={activeTab === 'storage' ? 'active' : ''}
            onClick={() => setActiveTab('storage')}
          >
            <HardDrive size={13} /> Cloud Storage
            {cloudActionBusy && <LoaderCircle className="spin" size={11} />}
          </button>
        </nav>
        <div className="privacy-note">
          <span className="privacy-dot" />
          Cấu hình tự động lưu trên máy
        </div>
      </header>

      {activeTab === 'encode' ? (
      <main className="workspace">
        <section className="config-panel">
          <div className="section-heading hero-heading">
            <div>
              <span className="eyebrow">NEW ENCODE</span>
              <h1>Biến video thành HLS.</h1>
              <p>Encode cục bộ, rồi tự đưa HLS lên OnzLoad hoặc storage bạn chọn.</p>
            </div>
            <div className="step-indicator" aria-label="Bước một trên ba">
              <span className={media ? 'done' : 'active'}>{media ? <Check size={12} /> : '1'}</span>
              <i className={media ? 'filled' : ''} />
              <span className={media ? 'active' : ''}>2</span>
              <i />
              <span>3</span>
            </div>
          </div>

          <div className="config-scroll">
            <section className="config-section">
              <div className="config-label">
                <span>01</span>
                <div>
                  <h2>Video nguồn & encode queue</h2>
                  <p>Chọn nhiều video; app sẽ xử lý tuần tự</p>
                </div>
              </div>

              {!media ? (
                <button
                  className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
                  type="button"
                  onClick={chooseInput}
                  disabled={isBusy}
                >
                  {status === 'probing' ? (
                    <LoaderCircle className="spin" size={26} />
                  ) : (
                    <FileVideo2 size={28} strokeWidth={1.6} />
                  )}
                  <span>{status === 'probing' ? 'Đang đọc metadata…' : 'Thả nhiều video vào đây'}</span>
                  <small>hoặc nhấn để chọn nhiều tệp</small>
                </button>
              ) : (
                <div className="source-card">
                  <div className="source-icon">
                    <FileVideo2 size={24} strokeWidth={1.7} />
                  </div>
                  <div className="source-main">
                    <strong title={media.name}>{media.name}</strong>
                    <span title={media.path}>{media.path}</span>
                  </div>
                  <div className="source-meta">
                    <span>{media.width} × {media.height}</span>
                    <span>{formatDuration(media.durationSeconds)}</span>
                    <span>{formatBytes(media.sizeBytes)}</span>
                    <span>{media.subtitleTracks.length} sub</span>
                  </div>
                  <button className="text-button" type="button" onClick={chooseInput} disabled={isBusy}>
                    + Thêm video
                  </button>
                </div>
              )}

              {encodeQueue.length > 0 && (
                <div className="queue-card encode-queue-card">
                  <div className="queue-card-heading">
                    <span><ListOrdered size={14} /> Encode queue <em>{encodeQueue.length}</em></span>
                    <div>
                      <small>{encodeQueueSummary.finished}/{encodeQueueSummary.total} đã xử lý</small>
                      <button type="button" onClick={chooseInput} disabled={isBusy}><Plus size={12} /> Thêm</button>
                    </div>
                  </div>
                  <div className="queue-list">
                    {encodeQueue.map((item, index) => (
                      <div key={item.id} className={`queue-item ${item.status}`}>
                        <span className="queue-order">{String(index + 1).padStart(2, '0')}</span>
                        <span className="queue-item-icon"><FileVideo2 size={15} /></span>
                        <span className="queue-item-copy">
                          <strong title={item.media.name}>{item.media.name}</strong>
                          <small>{item.media.height}p · {formatDuration(item.media.durationSeconds)} · {item.media.videoCodec.toUpperCase()}</small>
                          {item.videoEncoderLabel && <small className="queue-encoder-label">{item.videoEncoderLabel}</small>}
                          {item.status === 'running' && item.progress && (
                            <i><b style={{ width: `${item.progress.percent}%` }} /></i>
                          )}
                          {item.error && <small className="queue-item-error" title={item.error}>{item.error}</small>}
                        </span>
                        <span className={`queue-item-status ${item.status}`}>
                          {item.status === 'running' && <LoaderCircle className="spin" size={10} />}
                          {queueStatusLabel(item.status)}
                        </span>
                        <span className="queue-item-actions">
                          {item.outputPath && item.status === 'completed' && (
                            <button type="button" title="Mở thư mục" onClick={() => window.encoder.revealInFolder(item.outputPath)}>
                              <FolderOpen size={12} />
                            </button>
                          )}
                          {(item.status === 'failed' || item.status === 'cancelled') && (
                            <button type="button" title="Đưa lại vào queue" onClick={() => retryEncodeQueueItem(item.id)} disabled={encodeQueueRunning}>
                              <RotateCcw size={12} />
                            </button>
                          )}
                          {item.status !== 'running' && (
                            <button type="button" title="Xóa khỏi queue" onClick={() => removeEncodeQueueItem(item.id)} disabled={encodeQueueRunning}>
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="config-section">
              <div className="config-label">
                <span>02</span>
                <div>
                  <h2>Cấu hình luồng</h2>
                  <p>Chọn bộ chất lượng phù hợp với người xem</p>
                </div>
              </div>

              <div className="preset-grid">
                {PRESETS.map((preset) => {
                  const codecCopyUnavailable =
                    preset.videoMode === 'copy' && Boolean(media && media.videoCodec.toLowerCase() !== 'h264');
                  const logoCopyUnavailable = preset.videoMode === 'copy' && logoOverlay.enabled;
                  const copyUnavailable = codecCopyUnavailable || logoCopyUnavailable;
                  const copyUnavailableMessage = logoCopyUnavailable
                    ? 'Tắt đóng logo để dùng Copy video'
                    : codecCopyUnavailable
                      ? 'Copy video chỉ khả dụng với nguồn H.264'
                      : '';
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`preset-card ${preset.videoMode === 'copy' ? 'copy-preset' : ''} ${presetId === preset.id ? 'selected' : ''}`}
                      onClick={() => setPresetId(preset.id)}
                      disabled={isBusy || copyUnavailable}
                      title={copyUnavailable ? copyUnavailableMessage : undefined}
                    >
                      <span className="selection-check"><Check size={11} /></span>
                      <span className="preset-icon">
                        {preset.videoMode === 'copy' ? <Zap size={19} /> : preset.id === 'single-source' ? <Film size={19} /> : <Layers3 size={19} />}
                      </span>
                      <strong>{preset.name}</strong>
                      <small>{copyUnavailable ? copyUnavailableMessage : renditionSummary(media, preset.id)}</small>
                    </button>
                  );
                })}
              </div>

              <div className={`encoder-selector ${selectedPreset.videoMode === 'copy' ? 'disabled' : ''}`}>
                <div>
                  <span><Cpu size={14} /> Bộ mã hóa video</span>
                  <small>{isHardwareLoading ? 'Đang chạy kiểm tra GPU thực tế…' : hardwareAcceleration.message}</small>
                </div>
                <select
                  value={videoEncoderId}
                  onChange={(event) => setVideoEncoderId(event.target.value as VideoEncoderId)}
                  disabled={isBusy || selectedPreset.videoMode === 'copy' || isHardwareLoading}
                >
                  <option value="auto">Tự động · {hardwareAcceleration.encoders.find((item) => item.id === hardwareAcceleration.recommendedId)?.label ?? 'CPU · x264'}</option>
                  {hardwareAcceleration.encoders.map((encoder) => (
                    <option key={encoder.id} value={encoder.id}>{encoder.label}</option>
                  ))}
                </select>
              </div>

              <div className="settings-row">
                <div className={`setting-block speed-block ${selectedPreset.videoMode === 'copy' ? 'disabled' : ''}`}>
                  <label><Gauge size={15} /> {selectedPreset.videoMode === 'copy' ? 'Không encode lại video' : 'Tốc độ encode'}</label>
                  <div className="segmented-control">
                    {SPEEDS.map((speed) => (
                      <button
                        key={speed.id}
                        type="button"
                        className={speedId === speed.id ? 'active' : ''}
                        onClick={() => setSpeedId(speed.id)}
                        disabled={isBusy || selectedPreset.videoMode === 'copy'}
                      >
                        {speed.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-block segment-block">
                  <label><SlidersHorizontal size={15} /> Độ dài segment</label>
                  <div className="segment-options">
                    {[4, 6, 10].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={segmentDuration === value ? 'active' : ''}
                        onClick={() => setSegmentDuration(value)}
                        disabled={isBusy}
                      >
                        {value}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                className={`advanced-settings-toggle ${showAdvancedSettings ? 'open' : ''}`}
                type="button"
                onClick={() => setShowAdvancedSettings((current) => !current)}
                aria-expanded={showAdvancedSettings}
              >
                <span>
                  <SlidersHorizontal size={14} />
                  <strong>Cấu hình nâng cao</strong>
                  <small>{hasCustomAdvancedSettings ? 'Đã tùy chỉnh' : 'Đang dùng mặc định an toàn'}</small>
                </span>
                <ChevronDown size={15} />
              </button>

              {showAdvancedSettings && (
                <div className="advanced-settings-panel">
                  <div className="advanced-settings-heading">
                    <div>
                      <strong>Điều khiển FFmpeg chi tiết</strong>
                      <small>Cấu hình được chụp riêng cho từng item khi bắt đầu queue.</small>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAdvancedSettings({ ...DEFAULT_ADVANCED_ENCODE_SETTINGS })}
                      disabled={isBusy || !hasCustomAdvancedSettings}
                    >
                      <RotateCcw size={12} /> Đặt lại
                    </button>
                  </div>

                  <div className="advanced-settings-group">
                    <div className="advanced-group-title">
                      <span>VIDEO</span>
                      <small>{selectedPreset.videoMode === 'copy' ? 'Không áp dụng vì video được copy nguyên vẹn' : selectedVideoEncoderLabel}</small>
                    </div>
                    <div className="advanced-field-grid">
                      <label className={selectedPreset.videoMode === 'copy' ? 'disabled' : ''}>
                        <span>Bitrate video</span>
                        <div className="number-with-unit">
                          <input
                            type="number"
                            min="25"
                            max="300"
                            step="5"
                            value={advancedSettings.videoBitratePercent}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value);
                              setAdvancedSettings((current) => ({ ...current, videoBitratePercent: value }));
                            }}
                            disabled={isBusy || selectedPreset.videoMode === 'copy'}
                          />
                          <em>% preset</em>
                        </div>
                        <small>GPU: bitrate đích · CPU: trần maxrate</small>
                      </label>

                      <label className={!cpuCrfAvailable ? 'disabled' : ''}>
                        <span>CRF CPU x264</span>
                        <div className="number-with-unit">
                          <input
                            type="number"
                            min="0"
                            max="51"
                            step="1"
                            placeholder="Auto"
                            value={advancedSettings.cpuCrf ?? ''}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setAdvancedSettings((current) => ({ ...current, cpuCrf: value === '' ? null : Number(value) }));
                            }}
                            disabled={isBusy || !cpuCrfAvailable}
                          />
                          <em>{advancedSettings.cpuCrf == null ? 'Theo tốc độ' : 'CRF'}</em>
                        </div>
                        <small>Thấp hơn = đẹp hơn và file lớn hơn</small>
                      </label>

                      <label className={selectedPreset.videoMode === 'copy' ? 'disabled' : ''}>
                        <span>H.264 profile</span>
                        <select
                          value={advancedSettings.h264Profile}
                          onChange={(event) => {
                            const value = event.currentTarget.value as AdvancedEncodeSettings['h264Profile'];
                            setAdvancedSettings((current) => ({ ...current, h264Profile: value }));
                          }}
                          disabled={isBusy || selectedPreset.videoMode === 'copy'}
                        >
                          <option value="baseline">Baseline · tương thích cao</option>
                          <option value="main">Main · mặc định</option>
                          <option value="high">High · hiệu quả hơn</option>
                        </select>
                        <small>Main phù hợp phần lớn thiết bị HLS</small>
                      </label>

                      <label className={selectedPreset.videoMode === 'copy' ? 'disabled' : ''}>
                        <span>FPS đầu ra</span>
                        <select
                          value={String(advancedSettings.outputFps)}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setAdvancedSettings((current) => ({ ...current, outputFps: value === 'source' ? 'source' : Number(value) }));
                          }}
                          disabled={isBusy || selectedPreset.videoMode === 'copy'}
                        >
                          <option value="source">Giữ FPS nguồn</option>
                          {[24, 25, 30, 50, 60].map((value) => <option key={value} value={value}>{value} fps</option>)}
                        </select>
                        <small>Giảm FPS có thể tăng tốc và giảm dung lượng</small>
                      </label>

                      <label className={selectedPreset.videoMode === 'copy' ? 'disabled' : ''}>
                        <span>Khoảng keyframe</span>
                        <select
                          value={String(advancedSettings.keyframeIntervalSeconds)}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setAdvancedSettings((current) => ({ ...current, keyframeIntervalSeconds: value === 'segment' ? 'segment' : Number(value) }));
                          }}
                          disabled={isBusy || selectedPreset.videoMode === 'copy'}
                        >
                          <option value="segment">Khớp độ dài segment</option>
                          {[1, 2, 3, 4, 6].map((value) => <option key={value} value={value}>{value} giây</option>)}
                        </select>
                        <small>Keyframe ngắn giúp tua nhanh nhưng tăng bitrate</small>
                      </label>

                      <label className={selectedPreset.videoMode === 'copy' ? 'disabled' : ''}>
                        <span>Thuật toán scale</span>
                        <select
                          value={advancedSettings.scaleAlgorithm}
                          onChange={(event) => {
                            const value = event.currentTarget.value as AdvancedEncodeSettings['scaleAlgorithm'];
                            setAdvancedSettings((current) => ({ ...current, scaleAlgorithm: value }));
                          }}
                          disabled={isBusy || selectedPreset.videoMode === 'copy'}
                        >
                          <option value="fast_bilinear">Fast bilinear · nhanh</option>
                          <option value="bicubic">Bicubic · cân bằng</option>
                          <option value="lanczos">Lanczos · sắc nét</option>
                        </select>
                        <small>Scale hiện vẫn chạy bằng CPU</small>
                      </label>
                    </div>

                    <label className={`advanced-switch ${selectedPreset.videoMode === 'copy' ? 'disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={advancedSettings.deinterlace}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setAdvancedSettings((current) => ({ ...current, deinterlace: checked }));
                        }}
                        disabled={isBusy || selectedPreset.videoMode === 'copy'}
                      />
                      <span><i /> Khử sọc video interlaced bằng YADIF</span>
                      <small>Chỉ bật cho nguồn TV/DVD có sọc ngang chuyển động.</small>
                    </label>
                  </div>

                  <div className="advanced-settings-group">
                    <div className="advanced-group-title">
                      <span>AUDIO & HLS</span>
                      <small>Áp dụng cho cả Copy và Adaptive</small>
                    </div>
                    <div className="advanced-field-grid">
                      <label>
                        <span>Bitrate AAC</span>
                        <select
                          value={advancedSettings.audioBitrateKbps ?? 'preset'}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setAdvancedSettings((current) => ({ ...current, audioBitrateKbps: value === 'preset' ? null : Number(value) }));
                          }}
                          disabled={isBusy}
                        >
                          <option value="preset">Theo preset</option>
                          {[64, 96, 128, 160, 192, 256, 320].map((value) => <option key={value} value={value}>{value} kbps</option>)}
                        </select>
                        <small>Copy mặc định dùng 192 kbps</small>
                      </label>

                      <label>
                        <span>Kênh audio</span>
                        <select
                          value={String(advancedSettings.audioChannels)}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setAdvancedSettings((current) => ({
                              ...current,
                              audioChannels: value === 'source' ? 'source' : Number(value) as 1 | 2 | 6,
                            }));
                          }}
                          disabled={isBusy}
                        >
                          <option value="source">Giữ số kênh nguồn</option>
                          <option value="1">Mono · 1.0</option>
                          <option value="2">Stereo · 2.0</option>
                          <option value="6">Surround · 5.1</option>
                        </select>
                        <small>Stereo tương thích trình duyệt tốt nhất</small>
                      </label>

                      <label>
                        <span>Sample rate</span>
                        <select
                          value={String(advancedSettings.audioSampleRate)}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setAdvancedSettings((current) => ({
                              ...current,
                              audioSampleRate: value === 'source' ? 'source' : Number(value) as 44_100 | 48_000,
                            }));
                          }}
                          disabled={isBusy}
                        >
                          <option value="source">Giữ sample rate nguồn</option>
                          <option value="44100">44.1 kHz</option>
                          <option value="48000">48 kHz · video</option>
                        </select>
                        <small>48 kHz thường dùng cho phim/video</small>
                      </label>

                      <label>
                        <span>Định dạng segment</span>
                        <select
                          value={advancedSettings.hlsSegmentType}
                          onChange={(event) => {
                            const value = event.currentTarget.value as AdvancedEncodeSettings['hlsSegmentType'];
                            setAdvancedSettings((current) => ({ ...current, hlsSegmentType: value }));
                          }}
                          disabled={isBusy}
                        >
                          <option value="mpegts">MPEG-TS · .ts tương thích rộng</option>
                          <option value="fmp4">Fragmented MP4 · .m4s</option>
                        </select>
                        <small>fMP4 tạo thêm init_*.mp4 cho mỗi rendition</small>
                      </label>

                      <label>
                        <span>Số segment bắt đầu</span>
                        <div className="number-with-unit">
                          <input
                            type="number"
                            min="0"
                            max="999999"
                            step="1"
                            value={advancedSettings.startNumber}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value);
                              setAdvancedSettings((current) => ({ ...current, startNumber: value }));
                            }}
                            disabled={isBusy}
                          />
                          <em>index</em>
                        </div>
                        <small>0 tạo segment_00000 như mặc định</small>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              <div className={`logo-overlay-card ${logoOverlay.enabled ? 'enabled' : ''}`}>
                <div className="logo-overlay-heading">
                  <div>
                    <span className="logo-overlay-icon"><ImageIcon size={15} /></span>
                    <span>
                      <strong>Đóng logo vào video</strong>
                      <small>Overlay logo lên mọi chất lượng HLS</small>
                    </span>
                  </div>
                  <label className="logo-overlay-toggle">
                    <input
                      type="checkbox"
                      checked={logoOverlay.enabled}
                      onChange={(event) => void toggleLogoOverlay(event.currentTarget.checked)}
                      disabled={isBusy}
                    />
                    <span><i /></span>
                  </label>
                </div>

                {logoOverlay.enabled && (
                  <div className="logo-overlay-settings">
                    <button className="logo-path-picker" type="button" onClick={chooseLogo} disabled={isBusy}>
                      <ImageIcon size={15} />
                      <span title={logoOverlay.path}>{logoOverlay.path ? baseNameOf(logoOverlay.path) : 'Chọn file PNG, JPG hoặc WebP'}</span>
                      <em>{logoOverlay.path ? 'Đổi ảnh' : 'Chọn ảnh'}</em>
                    </button>

                    <div className="logo-control-grid">
                      <label>
                        <span>Vị trí</span>
                        <select
                          value={logoOverlay.position}
                          onChange={(event) => {
                            const position = event.currentTarget.value as LogoOverlaySettings['position'];
                            setLogoOverlay((current) => ({ ...current, position }));
                          }}
                          disabled={isBusy}
                        >
                          {LOGO_POSITIONS.map((position) => (
                            <option key={position.id} value={position.id}>{position.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Kích thước <b>{logoOverlay.widthPercent}%</b></span>
                        <input
                          type="range"
                          min="3"
                          max="50"
                          step="1"
                          value={logoOverlay.widthPercent}
                          onChange={(event) => {
                            const widthPercent = Number(event.currentTarget.value);
                            setLogoOverlay((current) => ({ ...current, widthPercent }));
                          }}
                          disabled={isBusy}
                        />
                      </label>
                      <label>
                        <span>Độ trong suốt <b>{logoOverlay.opacityPercent}%</b></span>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          step="5"
                          value={logoOverlay.opacityPercent}
                          onChange={(event) => {
                            const opacityPercent = Number(event.currentTarget.value);
                            setLogoOverlay((current) => ({ ...current, opacityPercent }));
                          }}
                          disabled={isBusy}
                        />
                      </label>
                      <label>
                        <span>Lề khung hình <b>{logoOverlay.marginPercent}%</b></span>
                        <input
                          type="range"
                          min="0"
                          max="10"
                          step="0.5"
                          value={logoOverlay.marginPercent}
                          onChange={(event) => {
                            const marginPercent = Number(event.currentTarget.value);
                            setLogoOverlay((current) => ({ ...current, marginPercent }));
                          }}
                          disabled={isBusy}
                        />
                      </label>
                    </div>
                    <div className="logo-overlay-note">
                      <span>Logo cần encode lại video và sẽ dùng thêm tài nguyên CPU cho bộ lọc overlay.</span>
                      <button
                        type="button"
                        onClick={() => setLogoOverlay({ ...DEFAULT_LOGO_OVERLAY_SETTINGS })}
                        disabled={isBusy}
                      >
                        <X size={11} /> Bỏ logo
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {selectedPreset.videoMode === 'copy' && (
                <div className="copy-mode-note">
                  <Zap size={14} />
                  <span><strong>Gần tốc độ lệnh Terminal.</strong> Video H.264 được copy nguyên vẹn; mốc segment sẽ bám theo keyframe có sẵn trong nguồn.</span>
                </div>
              )}
            </section>

            <section className="config-section subtitle-section">
              <div className="subtitle-section-heading">
                <div className="config-label">
                  <span>03</span>
                  <div>
                    <h2>Subtitle nhúng</h2>
                    <p>Chọn track cần tách thành file subtitle riêng</p>
                  </div>
                </div>
                {media && media.subtitleTracks.length > 0 && (
                  <button
                    className="select-all-button"
                    type="button"
                    onClick={toggleAllSubtitles}
                    disabled={isBusy}
                  >
                    {selectedSubtitleIndices.length === media.subtitleTracks.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                  </button>
                )}
              </div>

              {!media ? (
                <div className="subtitle-empty">
                  <Captions size={19} />
                  <span>Chọn video nguồn để quét subtitle track.</span>
                </div>
              ) : media.subtitleTracks.length === 0 ? (
                <div className="subtitle-empty">
                  <Captions size={19} />
                  <span>Video này không có subtitle nhúng.</span>
                </div>
              ) : (
                <>
                  <div className="subtitle-list">
                    {media.subtitleTracks.map((track) => {
                      const selected = selectedSubtitleIndices.includes(track.streamIndex);
                      return (
                        <button
                          key={track.streamIndex}
                          type="button"
                          className={`subtitle-track ${selected ? 'selected' : ''}`}
                          onClick={() => toggleSubtitleTrack(track.streamIndex)}
                          disabled={isBusy}
                          aria-pressed={selected}
                        >
                          <span className="subtitle-checkbox">{selected && <Check size={11} />}</span>
                          <span className={`subtitle-kind ${track.kind}`}>
                            {track.kind === 'text' ? <Captions size={17} /> : <ImageIcon size={17} />}
                          </span>
                          <span className="subtitle-info">
                            <strong>{track.title || `Subtitle ${track.ordinal + 1}`}</strong>
                            <small>Track {track.streamIndex} · {track.codec} · {track.kind === 'text' ? 'Văn bản' : 'Dạng ảnh'}</small>
                          </span>
                          <span className="subtitle-badges">
                            {track.language && <em>{track.language.toUpperCase()}</em>}
                            {track.isDefault && <em>DEFAULT</em>}
                            {track.isForced && <em>FORCED</em>}
                            <b>.{track.extension}</b>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="subtitle-export-bar">
                    <div className={`subtitle-export-feedback ${subtitleExportStatus}`}>
                      {subtitleExportStatus === 'success' ? <CheckCircle2 size={15} /> : subtitleExportStatus === 'failed' ? <AlertCircle size={15} /> : <Captions size={15} />}
                      <span title={subtitleExportMessage}>
                        {subtitleExportMessage || `${selectedSubtitleIndices.length}/${media.subtitleTracks.length} track được chọn`}
                      </span>
                      {subtitleExportStatus === 'success' && subtitleOutputDirectory && (
                        <button type="button" onClick={() => window.encoder.revealInFolder(subtitleOutputDirectory)}>Mở thư mục</button>
                      )}
                    </div>
                    <button
                      className="export-subtitle-button"
                      type="button"
                      disabled={selectedSubtitleIndices.length === 0 || isBusy}
                      onClick={exportSelectedSubtitles}
                    >
                      {isSubtitleExporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
                      {isSubtitleExporting ? 'Đang xuất…' : `Xuất ${selectedSubtitleIndices.length || ''} file`}
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="config-section output-section">
              <div className="config-label">
                <span>04</span>
                <div>
                  <h2>Thư mục đầu ra</h2>
                  <p>Mỗi encode được lưu trong một thư mục riêng</p>
                </div>
              </div>
              <button className="path-picker" type="button" onClick={chooseOutput} disabled={isBusy}>
                <FolderOpen size={18} />
                <span>{outputDirectory || 'Chọn nơi lưu master.m3u8 và các segment'}</span>
                <em>Duyệt</em>
              </button>
            </section>

          </div>

          <div className="action-bar">
            <div className="encode-summary">
              <span><ListOrdered size={14} /> {encodeQueueSummary.queued} chờ · {encodeQueueSummary.completed} xong · {encodeQueueSummary.failed} lỗi</span>
              <small>{selectedPreset.name} · {renditionSummary(media, presetId)} · {selectedVideoEncoderLabel} · segment {segmentDuration}s{logoOverlay.enabled ? ` · logo ${logoOverlay.widthPercent}%` : ''}{hasCustomAdvancedSettings ? ' · nâng cao' : ''}{uploadAfterEncodeOnzload ? ' · tự tạo video OnzLoad' : uploadAfterEncode ? ' · upload cuốn chiếu' : ''}</small>
            </div>
            {encodeQueueRunning ? (
              <button className="cancel-button" type="button" onClick={cancelEncode}>
                <Pause size={15} fill="currentColor" /> Dừng queue
              </button>
            ) : (
              <button className="start-button" type="button" disabled={!canStart} onClick={startEncode}>
                <Play size={17} fill="currentColor" /> Chạy encode queue ({encodeQueueSummary.queued})
              </button>
            )}
          </div>
        </section>

        <aside className="status-panel">
          <div className="status-heading">
            <div>
              <span className="eyebrow">ENCODE STATUS</span>
              <h2>Tiến trình queue</h2>
            </div>
            <span className={`status-chip ${encodeQueueRunning ? 'encoding' : status}`}>
              <i />
              {encodeQueueRunning
                ? `${encodeQueueSummary.finished + encodeQueueSummary.running}/${encodeQueueSummary.total} ĐANG CHẠY`
                : status === 'completed'
                  ? 'HOÀN TẤT'
                  : status === 'failed'
                    ? 'CÓ LỖI'
                    : status === 'cancelled'
                      ? 'ĐÃ HỦY'
                      : 'CHỜ TÁC VỤ'}
            </span>
          </div>

          <div className="status-content">
            {(status === 'idle' || status === 'ready') && (media ? <SourcePreview media={media} logoOverlay={logoOverlay} /> : <EmptyProgress />)}
            {status === 'probing' && <EmptyProgress />}

            {(status === 'encoding' || status === 'completed') && progress && (
              <div className="active-progress">
                <div className="progress-hero">
                  <div className="progress-ring" style={progressStyle}>
                    <div>
                      {status === 'completed' ? (
                        <CheckCircle2 size={34} />
                      ) : (
                        <>
                          <strong>{Math.round(progress.percent)}</strong>
                          <span>%</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="progress-copy">
                    <span>{status === 'completed' ? 'Encode thành công' : progress.statusText}</span>
                    <h3 title={media?.name}>{media?.name}</h3>
                    <p>{status === 'completed' ? `master.m3u8 đã sẵn sàng · ${activeVideoEncoderLabel}` : `${renditionSummary(media, presetId)} · ${activeVideoEncoderLabel || selectedVideoEncoderLabel}`}</p>
                  </div>
                </div>

                <div className="progress-track"><span style={{ width: `${progress.percent}%` }} /></div>

                <div className="metric-grid">
                  <div>
                    <Clock3 size={16} />
                    <span>Đã xử lý</span>
                    <strong>{formatDuration(progress.encodedSeconds)} <small>/ {formatDuration(progress.durationSeconds)}</small></strong>
                  </div>
                  <div>
                    <Gauge size={16} />
                    <span>Tốc độ</span>
                    <strong>{progress.speed ? `${progress.speed.toFixed(2)}×` : '—'}</strong>
                  </div>
                  <div>
                    <Zap size={16} />
                    <span>FPS đầu ra</span>
                    <strong title="FPS thật của video HLS; tốc độ xử lý nằm ở ô Tốc độ">{formatFps(progress.fps)}</strong>
                  </div>
                  <div>
                    <Clock3 size={16} />
                    <span>Còn lại</span>
                    <strong>{status === 'completed' ? '0:00' : formatDuration(progress.etaSeconds)}</strong>
                  </div>
                </div>

                {status === 'completed' && !encodeQueueRunning && (
                  <div className="complete-actions three-actions">
                    <button type="button" onClick={() => window.encoder.revealInFolder(outputPath)}>
                      <Folder size={16} /> Mở thư mục
                    </button>
                    <button className="go-upload-button" type="button" onClick={() => openUploadTab(outputPath)}>
                      <CloudUpload size={15} /> Qua tab Upload
                    </button>
                    <button type="button" onClick={resetJob} disabled={isUploading}>
                      <RotateCcw size={15} /> Video khác
                    </button>
                  </div>
                )}
              </div>
            )}

            {(status === 'failed' || status === 'cancelled') && (
              <div className="error-state">
                <div className={status === 'cancelled' ? 'cancelled-icon' : 'error-icon'}>
                  {status === 'cancelled' ? <Square size={23} /> : <AlertCircle size={25} />}
                </div>
                <h3>{status === 'cancelled' ? 'Đã dừng encode' : 'Không thể hoàn tất encode'}</h3>
                <p>{status === 'cancelled' ? 'Các segment đã tạo vẫn còn trong thư mục đầu ra.' : errorMessage}</p>
                <button type="button" onClick={resetJob}><RotateCcw size={15} /> Thử lại</button>
              </div>
            )}
          </div>

          <div className={`log-panel ${showLogs ? 'expanded' : ''}`}>
            <button className="log-toggle" type="button" onClick={() => setShowLogs((current) => !current)}>
              <span><Terminal size={15} /> Nhật ký FFmpeg / rclone <em>{logs.length}</em></span>
              <ChevronDown size={16} />
            </button>
            {showLogs && (
              <div className="log-output" ref={logOutputRef}>
                {logs.length === 0 ? <span className="log-empty">Chưa có dữ liệu log.</span> : logs.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}
              </div>
            )}
          </div>
        </aside>
      </main>
      ) : activeTab === 'upload' ? (
      <main className="workspace upload-workspace">
        <section className="config-panel upload-config-panel">
          <div className="section-heading hero-heading upload-hero-heading">
            <div>
              <span className="eyebrow">ONZLOAD · RCLONE TRANSFER</span>
              <h1>Đưa HLS lên OnzLoad.</h1>
              <p>Đăng nhập tài khoản để app tự upload và tạo video, hoặc dùng remote R2 / S3 thủ công.</p>
            </div>
            <CloudUpload className="upload-hero-icon" size={35} strokeWidth={1.35} />
          </div>

          <div className="config-scroll upload-config-scroll">
            <section className="config-section onzload-section">
              <div className="config-label">
                <span>ONZ</span>
                <div>
                  <h2>Tài khoản OnzLoad</h2>
                  <p>Đăng nhập qua trình duyệt; app chỉ lưu token thiết bị đã mã hóa</p>
                </div>
              </div>

              <div className={`onzload-account-card ${onzloadSession.connected ? 'connected' : ''}`}>
                <div className="onzload-account-status">
                  <span>{onzloadSession.connected ? <ShieldCheck size={17} /> : <Link2 size={17} />}</span>
                  <div>
                    <strong>{onzloadSession.user?.displayName || onzloadSession.user?.email || 'Chưa liên kết OnzLoad'}</strong>
                    <small>{onzloadSession.connected ? `${onzloadSession.user?.plan} · ${onzloadSession.user?.email}` : onzloadSession.message}</small>
                  </div>
                  {onzloadSession.connected && <em>ĐÃ KẾT NỐI</em>}
                </div>
                <div className="onzload-connect-row">
                  <label>
                    <span>Trang OnzLoad</span>
                    <input
                      type="url"
                      value={onzloadBaseUrl}
                      onChange={(event) => setOnzloadBaseUrl(event.target.value)}
                      disabled={onzloadAuthBusy || onzloadSession.connected}
                      spellCheck={false}
                    />
                  </label>
                  <button type="button" onClick={() => void (onzloadSession.connected ? disconnectOnzload() : connectOnzload())} disabled={onzloadAuthBusy || onzloadQueueRunning}>
                    {onzloadAuthBusy ? <LoaderCircle className="spin" size={14} /> : onzloadSession.connected ? <X size={14} /> : <ExternalLink size={14} />}
                    {onzloadAuthBusy ? 'Đang xử lý…' : onzloadSession.connected ? 'Ngắt liên kết' : 'Đăng nhập' }
                  </button>
                </div>
                <p className="onzload-session-message">{onzloadSession.message}{onzloadSession.capabilities ? ` · Tối đa ${onzloadSession.capabilities.upload.maxFileSizeLabel}/video` : ''}</p>
                <div className="onzload-options-row">
                  <label className="auto-upload-toggle">
                    <input
                      type="checkbox"
                      checked={uploadAfterEncodeOnzload}
                      onChange={(event) => {
                        if (event.target.checked && !onzloadSession.connected) return;
                        setUploadAfterEncodeOnzload(event.target.checked);
                        if (event.target.checked) setUploadAfterEncode(false);
                      }}
                      disabled={encodeQueueRunning}
                    />
                    <span><b>Tự upload và tạo video sau mỗi encode</b><small>Ép đầu ra H.264/yuv420p + AAC stereo 48k tương thích OnzLoad</small></span>
                  </label>
                  <button type="button" className="onzload-upload-now" onClick={uploadCurrentFolderToOnzload} disabled={!onzloadSession.connected || !localHlsPath || onzloadQueueRunning}>
                    <CloudUpload size={14} /> Upload folder hiện tại
                  </button>
                </div>
              </div>

              {onzloadQueue.length > 0 && (
                <div className="queue-card onzload-queue-card">
                  <div className="queue-card-heading">
                    <span><ListOrdered size={14} /> OnzLoad queue <em>{onzloadQueue.length}</em></span>
                    <div>
                      <small>{onzloadQueueSummary.finished}/{onzloadQueueSummary.total} đã xử lý</small>
                      {onzloadQueueRunning && <button type="button" onClick={() => void cancelOnzloadUpload()}><Pause size={12} /> Dừng</button>}
                    </div>
                  </div>
                  <div className="queue-list">
                    {onzloadQueue.map((item, index) => (
                      <div key={item.id} className={`queue-item ${item.status}`}>
                        <span className="queue-order">{String(index + 1).padStart(2, '0')}</span>
                        <span className="queue-item-icon"><CloudUpload size={15} /></span>
                        <span className="queue-item-copy">
                          <strong title={item.sourcePath}>{item.originalName}</strong>
                          <small title={item.destination || item.sourcePath}>{item.destination || baseNameOf(item.sourcePath)}</small>
                          {item.embedUrl && <small className="queue-public-url" title={item.embedUrl}>{item.embedUrl}</small>}
                          {item.status === 'running' && item.progress && <i><b style={{ width: `${item.progress.percent}%` }} /></i>}
                          {item.error && <small className="queue-item-error" title={item.error}>{item.error}</small>}
                        </span>
                        <span className={`queue-item-status ${item.status}`}>
                          {item.status === 'running' && <LoaderCircle className="spin" size={10} />}
                          {queueStatusLabel(item.status)}
                        </span>
                        <span className="queue-item-actions">
                          {item.embedUrl && <button type="button" title="Sao chép link embed" onClick={() => void window.encoder.copyText(item.embedUrl)}><Copy size={12} /></button>}
                          {item.embedUrl && <button type="button" title="Mở video OnzLoad" onClick={() => void window.encoder.openExternal(item.embedUrl)}><ExternalLink size={12} /></button>}
                          {(item.status === 'failed' || item.status === 'cancelled') && <button type="button" title="Thử upload lại" onClick={() => retryOnzloadQueueItem(item.id)} disabled={onzloadQueueRunning}><RotateCcw size={12} /></button>}
                          {item.status !== 'running' && <button type="button" title="Xóa khỏi queue" onClick={() => removeOnzloadQueueItem(item.id)} disabled={onzloadQueueRunning}><X size={12} /></button>}
                        </span>
                      </div>
                    ))}
                  </div>
                  {onzloadLogs.length > 0 && <code className="onzload-last-log">{onzloadLogs.at(-1)}</code>}
                </div>
              )}
            </section>

            <section className="config-section cloud-section">
              <div className="cloud-heading">
                <div className="config-label">
                  <span>01</span>
                  <div>
                    <h2>Cấu hình rclone</h2>
                    <p>Tạo mới hoặc cập nhật remote Cloudflare R2 / S3</p>
                  </div>
                </div>
                <button className="rclone-refresh" type="button" onClick={() => void refreshRclone()} disabled={isUploading || isRcloneLoading}>
                  <RefreshCw className={isRcloneLoading ? 'spin' : ''} size={13} /> Tải lại
                </button>
              </div>

              <div className={`rclone-config-card ${rcloneStatus.available ? 'available' : 'unavailable'}`}>
                <div className="rclone-status-line">
                  {rcloneStatus.available ? <ShieldCheck size={15} /> : <AlertCircle size={15} />}
                  <span>{isRcloneLoading ? 'Đang tìm rclone…' : rcloneStatus.message}</span>
                  {rcloneStatus.version && <em>v{rcloneStatus.version}</em>}
                </div>
              </div>

              <div className="remote-form-card">
                <div className="remote-form-heading">
                  <strong>Tạo / cập nhật remote</strong>
                  <span>Remote trùng tên sẽ được cập nhật; các remote khác được giữ nguyên.</span>
                </div>
                <div className="remote-form-grid">
                  <label>
                    <span>Nhà cung cấp</span>
                    <select
                      value={remoteProvider}
                      onChange={(event) => {
                        const provider = event.target.value as RcloneProvider;
                        setRemoteProvider(provider);
                        setRemoteRegion(provider === 'AWS' ? 'us-east-1' : 'auto');
                        setRemoteSaveStatus('idle');
                        setRemoteSaveMessage('');
                      }}
                      disabled={remoteSaveStatus === 'saving' || isUploading}
                    >
                      <option value="Cloudflare">Cloudflare R2</option>
                      <option value="AWS">Amazon S3</option>
                      <option value="Other">S3 tương thích</option>
                    </select>
                  </label>
                  <label>
                    <span>Tên remote</span>
                    <input
                      value={remoteName}
                      placeholder="dao-r2"
                      onChange={(event) => { setRemoteName(event.target.value); setRemoteSaveStatus('idle'); }}
                      disabled={remoteSaveStatus === 'saving' || isUploading}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>Access Key ID</span>
                    <input
                      value={remoteAccessKeyId}
                      placeholder="Nhập Access Key ID"
                      onChange={(event) => { setRemoteAccessKeyId(event.target.value); setRemoteSaveStatus('idle'); }}
                      disabled={remoteSaveStatus === 'saving' || isUploading}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>Secret Access Key</span>
                    <input
                      type="password"
                      value={remoteSecretAccessKey}
                      placeholder="Không hiển thị lại sau khi lưu"
                      onChange={(event) => { setRemoteSecretAccessKey(event.target.value); setRemoteSaveStatus('idle'); }}
                      disabled={remoteSaveStatus === 'saving' || isUploading}
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                  </label>
                  <label className="endpoint-field">
                    <span>Endpoint {remoteProvider === 'AWS' ? '(không bắt buộc)' : ''}</span>
                    <input
                      value={remoteEndpoint}
                      placeholder={remoteProvider === 'Cloudflare' ? 'https://account-id.r2.cloudflarestorage.com' : 'https://s3.example.com'}
                      onChange={(event) => { setRemoteEndpoint(event.target.value); setRemoteSaveStatus('idle'); }}
                      disabled={remoteSaveStatus === 'saving' || isUploading}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>Region</span>
                    <input
                      value={remoteRegion}
                      placeholder={remoteProvider === 'AWS' ? 'us-east-1' : 'auto'}
                      onChange={(event) => { setRemoteRegion(event.target.value); setRemoteSaveStatus('idle'); }}
                      disabled={remoteSaveStatus === 'saving' || isUploading}
                      spellCheck={false}
                    />
                  </label>
                </div>
                <div className="remote-save-row">
                  <span className={`remote-save-feedback ${remoteSaveStatus}`}>
                    {remoteSaveMessage || 'Secret được rclone làm mờ trước khi ghi vào rclone.conf.'}
                  </span>
                  <button type="button" onClick={saveRemote} disabled={!remoteCanSave}>
                    {remoteSaveStatus === 'saving' ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}
                    {remoteSaveStatus === 'saving' ? 'Đang lưu…' : 'Lưu remote'}
                  </button>
                </div>
              </div>
            </section>

            <section className="config-section">
              <div className="config-label">
                <span>02</span>
                <div>
                  <h2>HLS local & upload queue</h2>
                  <p>Chọn nhiều folder có master.m3u8; app upload tuần tự</p>
                </div>
              </div>
              <button className="path-picker hls-path-picker" type="button" onClick={chooseHlsFolder} disabled={isUploading || status === 'encoding'}>
                <FolderOpen size={18} />
                <span title={localHlsPath}>{localHlsPath || 'Chọn một hoặc nhiều thư mục HLS trên máy'}</span>
                <em>Duyệt</em>
              </button>
              {outputPath && outputPath !== localHlsPath && (
                <button className="use-latest-output" type="button" onClick={() => enqueueUploadPaths([outputPath])}>
                  + Thêm kết quả encode gần nhất vào queue
                </button>
              )}

              {uploadQueue.length > 0 && (
                <div className="queue-card upload-queue-card">
                  <div className="queue-card-heading">
                    <span><ListOrdered size={14} /> Upload queue <em>{uploadQueue.length}</em></span>
                    <div>
                      <small>{uploadQueueSummary.finished}/{uploadQueueSummary.total} đã xử lý</small>
                      <button type="button" onClick={chooseHlsFolder} disabled={isBusy}><Plus size={12} /> Thêm</button>
                    </div>
                  </div>
                  <div className="queue-list">
                    {uploadQueue.map((item, index) => (
                      <div key={item.id} className={`queue-item ${item.status}`}>
                        <span className="queue-order">{String(index + 1).padStart(2, '0')}</span>
                        <span className="queue-item-icon">{item.temporarySource ? <Link2 size={15} /> : <Folder size={15} />}</span>
                        <span className="queue-item-copy">
                          <strong title={item.sourcePath}>{baseNameOf(item.sourcePath)}</strong>
                          <small title={item.destination || undefined}>
                            {item.destination || (item.config ? `${item.config.remoteName}:${item.config.destinationPath}` : 'Dùng cấu hình đích hiện tại')}
                          </small>
                          {item.temporarySource && <small>Nguồn URL · tự xóa bản tạm sau khi upload thành công</small>}
                          {item.publicUrl && <small className="queue-public-url" title={item.publicUrl}>{item.publicUrl}</small>}
                          {item.status === 'running' && item.progress && (
                            <i><b style={{ width: `${item.progress.percent}%` }} /></i>
                          )}
                          {item.error && <small className="queue-item-error" title={item.error}>{item.error}</small>}
                        </span>
                        <span className={`queue-item-status ${item.status}`}>
                          {item.status === 'running' && <LoaderCircle className="spin" size={10} />}
                          {queueStatusLabel(item.status)}
                        </span>
                        <span className="queue-item-actions">
                          {item.status === 'completed' && !item.temporarySource && (
                            <button type="button" title="Mở thư mục local" onClick={() => window.encoder.revealInFolder(item.sourcePath)}>
                              <FolderOpen size={12} />
                            </button>
                          )}
                          {item.publicUrl && (
                            <button type="button" title="Sao chép URL master.m3u8" onClick={() => void copyPublicUrl(item.publicUrl)}>
                              {copiedPublicUrl === item.publicUrl ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          )}
                          {item.publicUrl && (
                            <button type="button" title="Mở URL public" onClick={() => void window.encoder.openExternal(item.publicUrl)}>
                              <ExternalLink size={12} />
                            </button>
                          )}
                          {(item.status === 'failed' || item.status === 'cancelled') && (
                            <button type="button" title="Đưa lại vào queue" onClick={() => retryUploadQueueItem(item.id)} disabled={uploadQueueRunning}>
                              <RotateCcw size={12} />
                            </button>
                          )}
                          {item.status !== 'running' && (
                            <button type="button" title="Xóa khỏi queue" onClick={() => removeUploadQueueItem(item.id)} disabled={uploadQueueRunning}>
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="config-section destination-section">
              <div className="config-label">
                <span>03</span>
                <div>
                  <h2>Đích upload</h2>
                  <p>Chọn remote và nhập bucket / thư mục chứa HLS</p>
                </div>
              </div>

              {rcloneStatus.remotes.length > 0 ? (
                <div className="rclone-fields destination-fields">
                  <label>
                    <span>Remote</span>
                    <select
                      value={selectedRemote}
                      onChange={(event) => {
                        setSelectedRemote(event.target.value);
                        setTargetCheckStatus('idle');
                        setTargetCheckMessage('');
                      }}
                      disabled={isUploading}
                    >
                      {rcloneStatus.remotes.map((remote) => (
                        <option key={remote.name} value={remote.name}>{remote.name} · {remote.type}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Bucket / thư mục</span>
                    <input
                      type="text"
                      value={remoteDestinationPath}
                      placeholder="ten-bucket/hls"
                      onChange={(event) => {
                        setRemoteDestinationPath(event.target.value);
                        setTargetCheckStatus('idle');
                        setTargetCheckMessage('');
                      }}
                      disabled={isUploading}
                      spellCheck={false}
                    />
                  </label>
                  <label className="public-url-field">
                    <span>URL public / CDN của bucket (không bắt buộc)</span>
                    <input
                      type="url"
                      value={publicBaseUrl}
                      placeholder="https://cdn.daophim.space"
                      onChange={(event) => changePublicBaseUrl(event.target.value)}
                      disabled={isUploading}
                      spellCheck={false}
                    />
                  </label>
                </div>
              ) : (
                <div className="no-remote-message"><AlertCircle size={15} /> Hãy tạo remote ở bước 01 trước khi chọn đích.</div>
              )}

              <div className="upload-performance-block">
                <div className="upload-performance-heading">
                  <span><Gauge size={13} /> Tốc độ upload</span>
                  <small>{selectedUploadPerformance.transfers} file song song · {selectedUploadPerformance.checkers} checkers</small>
                </div>
                <div className="upload-performance-options">
                  {RCLONE_UPLOAD_PERFORMANCE_PROFILES.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={uploadPerformanceId === profile.id ? 'selected' : ''}
                      onClick={() => setUploadPerformanceId(profile.id)}
                      disabled={isUploading || uploadQueueRunning}
                    >
                      <strong>{profile.name}</strong>
                      <span>{profile.transfers} luồng</span>
                      <small>{profile.description}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rclone-options-row">
                <label className="auto-upload-toggle">
                  <input
                    type="checkbox"
                    checked={uploadAfterEncode}
                    onChange={(event) => {
                      setUploadAfterEncode(event.target.checked);
                      if (event.target.checked) setUploadAfterEncodeOnzload(false);
                    }}
                    disabled={isUploading || encodeQueueRunning || !uploadConfigured}
                  />
                  <span><b>Upload ngay sau mỗi video encode xong</b><small>Upload chạy song song khi encode queue xử lý video kế tiếp</small></span>
                </label>
                <button
                  className="test-target-button"
                  type="button"
                  onClick={testUploadTarget}
                  disabled={isUploading || targetCheckStatus === 'checking' || !uploadConfigured}
                >
                  {targetCheckStatus === 'checking' ? <LoaderCircle className="spin" size={13} /> : <ShieldCheck size={13} />}
                  Kiểm tra kết nối
                </button>
              </div>

              <div className={`rclone-feedback ${targetCheckStatus}`}>
                <code title={destinationPreview}>{destinationPreview}</code>
                {targetCheckMessage && <span>{targetCheckMessage}</span>}
              </div>
              <div className={`public-url-preview ${publicBaseUrlError ? 'failed' : publicUrlPreview ? 'ready' : ''}`}>
                <Link2 size={12} />
                <div>
                  <span>URL master.m3u8 sau upload</span>
                  <code title={publicUrlPreview || publicBaseUrlError || undefined}>
                    {publicBaseUrlError || publicUrlPreview || 'Nhập custom domain hoặc URL r2.dev public của bucket để xuất link.'}
                  </code>
                </div>
                <button
                  className="copy-preview-url-button"
                  type="button"
                  onClick={() => void copyPublicUrl(publicUrlPreview)}
                  disabled={!publicUrlPreview || Boolean(publicBaseUrlError)}
                  title="Sao chép URL master.m3u8"
                  aria-label="Sao chép URL master.m3u8"
                >
                  {copiedPublicUrl === publicUrlPreview ? <Check size={12} /> : <Copy size={12} />}
                  {copiedPublicUrl === publicUrlPreview ? 'Đã copy' : 'Copy URL'}
                </button>
              </div>
            </section>
          </div>

          <div className="action-bar upload-action-bar">
            <div className="encode-summary">
              <span><ListOrdered size={14} /> {uploadQueueSummary.queued} chờ · {uploadQueueSummary.completed} xong · {uploadQueueSummary.failed} lỗi</span>
              <small title={destinationPreview}>{uploadConfigured ? `${destinationPreview} · ${selectedUploadPerformance.name} ${selectedUploadPerformance.transfers} luồng` : 'Cần remote và bucket / thư mục đích'}</small>
            </div>
            {uploadQueueRunning ? (
              <button className="cancel-button" type="button" onClick={cancelRcloneUpload}>
                <Pause size={15} fill="currentColor" /> Dừng queue
              </button>
            ) : (
              <button className="start-button upload-start-button" type="button" disabled={!canUpload} onClick={startRcloneUpload}>
                <CloudUpload size={17} /> Chạy upload queue ({uploadQueueSummary.queued})
              </button>
            )}
          </div>
        </section>

        <aside className="status-panel upload-status-panel">
          <div className="status-heading">
            <div>
              <span className="eyebrow">UPLOAD STATUS</span>
              <h2>Tiến trình upload queue</h2>
            </div>
            <span className={`status-chip ${uploadQueueRunning || uploadStatus === 'uploading' ? 'encoding' : uploadStatus === 'success' ? 'completed' : uploadStatus === 'failed' ? 'failed' : uploadStatus === 'cancelled' ? 'cancelled' : 'idle'}`}>
              <i />
              {uploadQueueRunning
                ? `${uploadQueueSummary.finished + uploadQueueSummary.running}/${uploadQueueSummary.total} ĐANG CHẠY`
                : uploadStatus === 'success'
                  ? 'HOÀN TẤT'
                  : uploadStatus === 'failed'
                    ? 'CÓ LỖI'
                    : uploadStatus === 'cancelled'
                      ? 'ĐÃ HỦY'
                      : 'CHỜ TÁC VỤ'}
            </span>
          </div>

          <div className="status-content upload-status-content">
            <div className={`upload-visual-state ${uploadStatus}`}>
              <div className="upload-cloud-orbit">
                {uploadStatus === 'uploading'
                  ? <LoaderCircle className="spin" size={35} />
                  : uploadStatus === 'success'
                    ? <CheckCircle2 size={35} />
                    : uploadStatus === 'failed'
                      ? <AlertCircle size={35} />
                      : <CloudUpload size={35} />}
              </div>
              <span>{uploadStatus === 'uploading' ? 'Đang chuyển dữ liệu' : uploadStatus === 'success' ? 'Upload thành công' : uploadStatus === 'failed' ? 'Upload thất bại' : 'Sẵn sàng upload'}</span>
              <h3 title={localHlsPath}>{localHlsPath ? baseNameOf(localHlsPath) : 'Chọn thư mục HLS local'}</h3>
              <p title={uploadDestination || destinationPreview}>
                {uploadStatus === 'success'
                  ? `Đã upload tới ${uploadDestination}`
                  : uploadStatus === 'failed'
                    ? uploadError
                    : uploadStatus === 'cancelled'
                      ? 'Upload đã dừng; file local vẫn được giữ nguyên.'
                      : uploadConfigured
                        ? destinationPreview
                        : 'Cấu hình remote và bucket ở bảng bên trái.'}
              </p>
            </div>

            {uploadProgress && (uploadStatus === 'uploading' || uploadStatus === 'success') && (
              <div className="upload-progress-card">
                <div className="upload-progress-number">
                  <strong>{Math.round(uploadProgress.percent)}%</strong>
                  <span>{uploadProgress.files} / {uploadProgress.totalFiles || '—'} file</span>
                </div>
                <div className="upload-progress-track"><span style={{ width: `${uploadProgress.percent}%` }} /></div>
                <div className="upload-progress-meta">
                  <span>{formatBytes(uploadProgress.bytes)} / {uploadProgress.totalBytes ? formatBytes(uploadProgress.totalBytes) : 'đang tính'}</span>
                  <span>{formatBytes(uploadProgress.speedBytesPerSecond)}/s</span>
                  <span>ETA {formatDuration(uploadProgress.etaSeconds)}</span>
                </div>
              </div>
            )}

            {uploadStatus === 'success' && uploadPublicUrl && (
              <div className="public-url-result">
                <div>
                  <span><Link2 size={12} /> URL R2 public · master.m3u8</span>
                  <code title={uploadPublicUrl}>{uploadPublicUrl}</code>
                </div>
                <span className="public-url-actions">
                  <button type="button" onClick={() => void copyPublicUrl(uploadPublicUrl)}>
                    {copiedPublicUrl === uploadPublicUrl ? <Check size={13} /> : <Copy size={13} />}
                    {copiedPublicUrl === uploadPublicUrl ? 'Đã sao chép' : 'Sao chép'}
                  </button>
                  <button type="button" onClick={() => void window.encoder.openExternal(uploadPublicUrl)}>
                    <ExternalLink size={13} /> Mở URL
                  </button>
                </span>
              </div>
            )}

            <div className="upload-route-card">
              <div><span>Nguồn local</span><strong title={localHlsPath}>{localHlsPath || 'Chưa chọn'}</strong></div>
              <i />
              <div><span>Đích rclone</span><strong title={destinationPreview}>{uploadConfigured ? destinationPreview : 'Chưa cấu hình'}</strong></div>
            </div>
          </div>

          <div className={`log-panel ${showLogs ? 'expanded' : ''}`}>
            <button className="log-toggle" type="button" onClick={() => setShowLogs((current) => !current)}>
              <span><Terminal size={15} /> Nhật ký rclone <em>{uploadLogs.length}</em></span>
              <ChevronDown size={16} />
            </button>
            {showLogs && (
              <div className="log-output" ref={logOutputRef}>
                {uploadLogs.length === 0 ? <span className="log-empty">Chưa có dữ liệu log.</span> : uploadLogs.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}
              </div>
            )}
          </div>
        </aside>
      </main>
      ) : activeTab === 'url-upload' ? (
      <main className="workspace upload-workspace url-upload-workspace">
        <section className="config-panel upload-config-panel">
          <div className="section-heading hero-heading upload-hero-heading url-upload-hero">
            <div>
              <span className="eyebrow">REMOTE HLS MIRROR</span>
              <h1>Upload nhiều URL HLS.</h1>
              <p>Mỗi dòng một playlist .m3u8; kiểm tra xong danh sách rồi chủ động bấm Upload.</p>
            </div>
            <Link2 className="upload-hero-icon" size={35} strokeWidth={1.35} />
          </div>

          <div className="config-scroll url-upload-config-scroll">
            <section className="config-section url-source-section">
              <div className="config-label">
                <span>01</span>
                <div>
                  <h2>Danh sách URL HLS nguồn</h2>
                  <p>Mỗi dòng một link · app chỉ chạy sau khi bạn bấm Upload</p>
                </div>
              </div>

              <div className={`remote-hls-import url-hls-import ${remoteHlsStatus}`}>
                <div className="remote-hls-import-heading">
                  <span><Link2 size={14} /> Batch playlist cần đưa lên storage</span>
                  <small>URL/token không được lưu</small>
                </div>
                <div className="url-hls-folder-field">
                  <label>
                    <span>Tiền tố folder trên storage (không bắt buộc)</span>
                    <input
                      value={remoteHlsFolderName}
                      placeholder="ten-phim-hls · nhiều link sẽ thêm -01, -02…"
                      onChange={(event) => setRemoteHlsFolderName(event.target.value)}
                      disabled={remoteHlsWorkflowBusy}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
                <label className="url-hls-main-field">
                  <span>Danh sách playlist .m3u8 · mỗi dòng một link</span>
                  <textarea
                    value={remoteHlsUrl}
                    placeholder={'https://cdn.example.com/phim-01/master.m3u8\nhttps://cdn.example.com/phim-02/master.m3u8'}
                    onChange={(event) => {
                      setRemoteHlsUrl(event.target.value);
                      if (!remoteHlsWorkflowBusy) {
                        setRemoteHlsStatus('idle');
                        setRemoteHlsProgress(null);
                        setRemoteHlsMessage('');
                        const emptyBatchProgress = { total: 0, processed: 0, downloaded: 0, failed: 0, uploaded: 0, uploadFailed: 0 };
                        remoteHlsBatchSummaryRef.current = emptyBatchProgress;
                        setRemoteHlsBatchProgress(emptyBatchProgress);
                        setRemoteHlsBatchSourcePaths([]);
                        setUploadStatus('idle');
                        setUploadProgress(null);
                        setUploadPublicUrl('');
                        setUploadError('');
                      }
                    }}
                    disabled={remoteHlsWorkflowBusy}
                    autoComplete="off"
                    spellCheck={false}
                    rows={6}
                  />
                </label>

                <div className="remote-hls-import-actions url-hls-auto-row">
                  <span className={`remote-hls-feedback ${remoteHlsWorkflowFailed ? 'failed' : remoteHlsWorkflowCompleted ? 'success' : remoteHlsStatus}`} title={remoteHlsMessage || undefined}>
                    {isRemoteHlsDownloading && remoteHlsProgress
                      ? `Link ${remoteHlsCurrentPosition}/${remoteHlsBatchProgress.total} · ${remoteHlsProgress.completedFiles}/${remoteHlsProgress.discoveredFiles} file · đã upload ${remoteHlsBatchProgress.uploaded}`
                      : remoteHlsWorkflowUploading
                        ? `Đã tải ${remoteHlsBatchProgress.downloaded}/${remoteHlsBatchProgress.total} link · đang upload bằng rclone…`
                        : remoteHlsWorkflowPartial
                          ? `Hoàn tất một phần: ${remoteHlsBatchProgress.uploaded}/${remoteHlsBatchProgress.total} HLS đã upload.`
                        : remoteHlsWorkflowCompleted
                          ? `Hoàn tất tải và upload ${remoteHlsBatchProgress.total} HLS lên storage.`
                          : remoteHlsMessage || (remoteHlsUrl
                            ? remoteHlsUrlIsValid
                              ? uploadConfigured
                                ? `${parsedRemoteHlsUrls.length} URL hợp lệ · bấm Upload để bắt đầu.`
                                : 'Chưa có remote hoặc bucket đích. Hãy cấu hình storage ở bước 02.'
                              : `${invalidRemoteHlsUrlCount} dòng không hợp lệ · URL phải dùng HTTP/HTTPS và kết thúc bằng .m3u8.`
                            : 'Dán một hoặc nhiều URL HLS vào ô trên, sau đó bấm Upload.')}
                  </span>
                  <span className={`url-auto-badge ${remoteHlsUrlIsValid && uploadConfigured ? 'ready' : ''}`}>
                    <Zap size={11} /> {remoteHlsUrlIsValid && uploadConfigured ? 'SẴN SÀNG' : 'CHỜ'} · {parsedRemoteHlsUrls.length || 0} LINK
                  </span>
                </div>
                {isRemoteHlsDownloading && (
                  <div className="remote-hls-progress" aria-label={remoteHlsMessage}><span /></div>
                )}
              </div>
            </section>

            <section className="config-section destination-section url-storage-section">
              <div className="config-label">
                <span>02</span>
                <div>
                  <h2>Storage đích</h2>
                  <p>Dùng cấu hình rclone đã lưu trong tab Upload R2 / S3</p>
                </div>
              </div>

              {rcloneStatus.remotes.length > 0 ? (
                <>
                  <div className="rclone-fields destination-fields">
                    <label>
                      <span>Remote</span>
                      <select
                        value={selectedRemote}
                        onChange={(event) => setSelectedRemote(event.target.value)}
                        disabled={remoteHlsWorkflowBusy}
                      >
                        {rcloneStatus.remotes.map((remote) => (
                          <option key={remote.name} value={remote.name}>{remote.name} · {remote.type}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Bucket / thư mục</span>
                      <input
                        value={remoteDestinationPath}
                        placeholder="ten-bucket/media"
                        onChange={(event) => setRemoteDestinationPath(event.target.value)}
                        disabled={remoteHlsWorkflowBusy}
                        spellCheck={false}
                      />
                    </label>
                    <label className="public-url-field">
                      <span>URL public / CDN (không bắt buộc)</span>
                      <input
                        type="url"
                        value={publicBaseUrl}
                        placeholder="https://cdn.daophim.space"
                        onChange={(event) => changePublicBaseUrl(event.target.value)}
                        disabled={remoteHlsWorkflowBusy}
                        spellCheck={false}
                      />
                    </label>
                  </div>

                  <div className="url-storage-actions">
                    <div>
                      <span>Đích tự động</span>
                      <code title={destinationPreview}>{destinationPreview}</code>
                    </div>
                    <button type="button" onClick={testUploadTarget} disabled={!uploadConfigured || remoteHlsWorkflowBusy || targetCheckStatus === 'checking'}>
                      {targetCheckStatus === 'checking' ? <LoaderCircle className="spin" size={12} /> : <ShieldCheck size={12} />}
                      Kiểm tra storage
                    </button>
                  </div>
                  {targetCheckMessage && <div className={`url-storage-feedback ${targetCheckStatus}`}>{targetCheckMessage}</div>}
                </>
              ) : (
                <div className="url-storage-empty">
                  <AlertCircle size={18} />
                  <div><strong>Chưa có remote rclone</strong><span>Tạo remote R2/S3 trước khi dùng upload tự động.</span></div>
                  <button type="button" onClick={() => setActiveTab('upload')}>Qua tab cấu hình</button>
                </div>
              )}

              <div className="url-upload-flow">
                <span><Download size={13} /><b>1. Tải HLS</b><small>playlist + segment + key</small></span>
                <i />
                <span><ListOrdered size={13} /><b>2. Tạo queue</b><small>giữ nguyên cây thư mục</small></span>
                <i />
                <span><CloudUpload size={13} /><b>3. Upload cuốn chiếu</b><small>{selectedUploadPerformance.name} · {selectedUploadPerformance.transfers} luồng</small></span>
              </div>
            </section>
          </div>

          <div className="action-bar upload-action-bar url-upload-action-bar">
            <div className="encode-summary">
              <span><Link2 size={14} /> {remoteHlsWorkflowCompleted ? 'Upload batch HLS hoàn tất' : remoteHlsWorkflowPartial ? 'Batch HLS hoàn tất một phần' : remoteHlsWorkflowBusy ? 'Đang xử lý batch URL HLS' : remoteHlsUrlIsValid ? 'Danh sách đã sẵn sàng' : 'Chờ danh sách URL HLS'}</span>
              <small>{uploadConfigured ? `${selectedRemote}:${remoteDestinationPath} · ${parsedRemoteHlsUrls.length || 0} link trong danh sách` : 'Cần cấu hình remote và bucket / thư mục đích'}</small>
            </div>
            {isRemoteHlsDownloading ? (
              <button className="cancel-button" type="button" onClick={cancelRemoteHlsDownload}>
                <Square size={14} fill="currentColor" /> Hủy batch
              </button>
            ) : remoteHlsWorkflowUploading ? (
              <button className="cancel-button" type="button" onClick={cancelRcloneUpload}>
                <Pause size={14} fill="currentColor" /> Dừng upload
              </button>
            ) : (
              <button
                className="start-button upload-start-button"
                type="button"
                disabled={!remoteHlsUrlIsValid || !uploadConfigured || isBusy || Boolean(publicBaseUrlError)}
                onClick={() => void startRemoteHlsDownload()}
              >
                <CloudUpload size={16} /> Bắt đầu upload {parsedRemoteHlsUrls.length || ''} link
              </button>
            )}
          </div>
        </section>

        <aside className="status-panel upload-status-panel url-upload-status-panel">
          <div className="status-heading">
            <div>
              <span className="eyebrow">URL HLS STATUS</span>
              <h2>Tiến trình batch URL HLS</h2>
            </div>
            <span className={`status-chip ${remoteHlsWorkflowBusy ? 'encoding' : remoteHlsWorkflowCompleted ? 'completed' : remoteHlsWorkflowPartial || remoteHlsWorkflowFailed ? 'failed' : remoteHlsWorkflowCancelled ? 'cancelled' : 'idle'}`}>
              <i />
              {remoteHlsDownloadingAndUploading
                  ? 'TẢI + UPLOAD'
                : isRemoteHlsDownloading
                  ? 'ĐANG TẢI HLS'
                : remoteHlsWorkflowUploading
                  ? 'ĐANG UPLOAD'
                  : remoteHlsWorkflowPartial
                    ? 'MỘT PHẦN'
                    : remoteHlsWorkflowCompleted
                    ? 'HOÀN TẤT'
                    : remoteHlsWorkflowFailed
                      ? 'CÓ LỖI'
                      : remoteHlsWorkflowCancelled
                        ? 'ĐÃ HỦY'
                        : remoteHlsUrlIsValid && uploadConfigured
                          ? 'SẴN SÀNG'
                          : 'CHỜ URL'}
            </span>
          </div>

          <div className="status-content upload-status-content url-upload-status-content">
            <div className={`upload-visual-state ${remoteHlsWorkflowCompleted ? 'success' : remoteHlsWorkflowPartial || remoteHlsWorkflowFailed ? 'failed' : remoteHlsWorkflowBusy ? 'uploading' : 'idle'}`}>
              <div className="upload-cloud-orbit">
                {remoteHlsWorkflowBusy
                  ? <LoaderCircle className="spin" size={35} />
                  : remoteHlsWorkflowCompleted
                    ? <CheckCircle2 size={35} />
                    : remoteHlsWorkflowPartial || remoteHlsWorkflowFailed
                      ? <AlertCircle size={35} />
                      : <Link2 size={35} />}
              </div>
              <span>{remoteHlsDownloadingAndUploading ? `Tải link ${remoteHlsCurrentPosition}/${remoteHlsBatchProgress.total} · upload song song` : isRemoteHlsDownloading ? `Đang tải link ${remoteHlsCurrentPosition}/${remoteHlsBatchProgress.total}` : remoteHlsWorkflowUploading ? 'Đang chuyển batch lên storage' : remoteHlsWorkflowCompleted ? 'Đã upload toàn bộ' : remoteHlsWorkflowPartial ? 'Đã upload một phần' : remoteHlsWorkflowFailed ? 'Không thể hoàn tất' : remoteHlsUrlIsValid && uploadConfigured ? 'Bấm Upload để bắt đầu' : 'Nhập URL và cấu hình storage'}</span>
              <h3>{remoteHlsWorkflowFinished ? `${remoteHlsBatchProgress.uploaded}/${remoteHlsBatchProgress.total} HLS trên storage` : remoteHlsDownloadingAndUploading ? `${remoteHlsBatchProgress.uploaded} đã upload · ${remoteHlsBatchProgress.downloaded} đã tải` : isRemoteHlsDownloading ? 'Đang tải playlist và segment…' : remoteHlsWorkflowUploading ? baseNameOf(localHlsPath) : 'N URL HLS → Storage'}</h3>
              <p>{remoteHlsMessage || (uploadConfigured ? destinationPreview : 'Cấu hình storage ở bảng bên trái trước khi dán URL.')}</p>
            </div>

            {remoteHlsBatchProgress.total > 0 && (
              <div className="url-download-metrics">
                <div><span>Đã xử lý</span><strong>{remoteHlsBatchProgress.processed} / {remoteHlsBatchProgress.total}</strong><small>link nguồn</small></div>
                <div><span>Tải thành công</span><strong>{remoteHlsBatchProgress.downloaded}</strong><small>HLS vào local tạm</small></div>
                <div><span>Đã upload</span><strong>{remoteHlsBatchProgress.uploaded}</strong><small>HLS trên storage</small></div>
                <div><span>Lỗi</span><strong>{remoteHlsBatchErrorCount}</strong><small>nguồn + upload</small></div>
                {isRemoteHlsDownloading && remoteHlsProgress && (
                  <div><span>Link hiện tại</span><strong>{remoteHlsProgress.completedFiles} / {remoteHlsProgress.discoveredFiles}</strong><small>{formatBytes(remoteHlsProgress.bytes)} local</small></div>
                )}
              </div>
            )}

            {uploadProgress && (remoteHlsWorkflowBusy || remoteHlsWorkflowFinished) && (
              <div className="upload-progress-card">
                <div className="upload-progress-number">
                  <strong>{Math.round(uploadProgress.percent)}%</strong>
                  <span>{uploadProgress.files} / {uploadProgress.totalFiles || '—'} file</span>
                </div>
                <div className="upload-progress-track"><span style={{ width: `${uploadProgress.percent}%` }} /></div>
                <div className="upload-progress-meta">
                  <span>{formatBytes(uploadProgress.bytes)} / {uploadProgress.totalBytes ? formatBytes(uploadProgress.totalBytes) : 'đang tính'}</span>
                  <span>{formatBytes(uploadProgress.speedBytesPerSecond)}/s</span>
                  <span>ETA {formatDuration(uploadProgress.etaSeconds)}</span>
                </div>
              </div>
            )}

            {remoteHlsPublicResults.length > 0 && (
              <div className="public-url-results">
                <div className="public-url-results-heading">
                  <span><Link2 size={12} /> URL HLS đã sẵn sàng</span>
                  <strong>{remoteHlsPublicResults.length}/{remoteHlsBatchProgress.downloaded}</strong>
                </div>
                <div className="public-url-results-list">
                  {remoteHlsPublicResults.map((item, index) => (
                    <div className="public-url-result" key={item.id}>
                      <div>
                        <span><CheckCircle2 size={12} /> Link {index + 1} · {baseNameOf(item.sourcePath)}</span>
                        <code title={item.publicUrl}>{item.publicUrl}</code>
                      </div>
                      <span className="public-url-actions">
                        <button type="button" onClick={() => void copyPublicUrl(item.publicUrl)}>
                          {copiedPublicUrl === item.publicUrl ? <Check size={13} /> : <Copy size={13} />}
                          {copiedPublicUrl === item.publicUrl ? 'Đã sao chép' : 'Sao chép'}
                        </button>
                        <button type="button" onClick={() => void window.encoder.openExternal(item.publicUrl)}><ExternalLink size={13} /> Mở URL</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="upload-route-card url-upload-route-card">
              <div><span>Nguồn</span><strong>{remoteHlsUrl ? `${parsedRemoteHlsUrls.length} URL HLS · token đã ẩn` : remoteHlsBatchProgress.total > 0 ? `${remoteHlsBatchProgress.total} URL HLS · đã ẩn` : 'Chưa nhập URL'}</strong></div>
              <i />
              <div><span>Storage</span><strong title={destinationPreview}>{uploadConfigured ? destinationPreview : 'Chưa cấu hình'}</strong></div>
            </div>
          </div>

          <div className={`log-panel ${showLogs ? 'expanded' : ''}`}>
            <button className="log-toggle" type="button" onClick={() => setShowLogs((current) => !current)}>
              <span><Terminal size={15} /> Nhật ký upload <em>{uploadLogs.length}</em></span>
              <ChevronDown size={16} />
            </button>
            {showLogs && (
              <div className="log-output" ref={logOutputRef}>
                {uploadLogs.length === 0 ? <span className="log-empty">Chưa có dữ liệu log.</span> : uploadLogs.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}
              </div>
            )}
          </div>
        </aside>
      </main>
      ) : (
      <main className="workspace cloud-storage-workspace">
        <section className="config-panel cloud-storage-browser-panel">
          <div className="section-heading hero-heading cloud-storage-hero">
            <div>
              <span className="eyebrow">RCLONE OBJECT MANAGER</span>
              <h1>Quản lý Cloud Storage.</h1>
              <p>Duyệt và CRUD file, thư mục trên Cloudflare R2, Amazon S3 hoặc S3 tương thích.</p>
            </div>
            <HardDrive className="upload-hero-icon" size={35} strokeWidth={1.35} />
          </div>

          <div className="config-scroll cloud-storage-scroll">
            <section className="config-section cloud-storage-location-section">
              <div className="cloud-storage-location-grid">
                <label>
                  <span>Remote rclone</span>
                  <select
                    value={selectedRemote}
                    onChange={(event) => {
                      setSelectedRemote(event.target.value);
                      setCloudStorageLoadedRemote('');
                      setCloudStorageEntries([]);
                    }}
                    disabled={cloudActionBusy || cloudStorageLoading}
                  >
                    {rcloneStatus.remotes.length === 0 && <option value="">Chưa có remote</option>}
                    {rcloneStatus.remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name} · {remote.type}</option>)}
                  </select>
                </label>
                <label className="cloud-storage-path-field">
                  <span>Bucket / đường dẫn hiện tại</span>
                  <input
                    value={cloudStoragePath}
                    placeholder="daophim-files/media"
                    onChange={(event) => setCloudStoragePath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void loadCloudStorage(cloudStoragePath);
                    }}
                    disabled={cloudActionBusy || cloudStorageLoading}
                    spellCheck={false}
                  />
                </label>
                <div className="cloud-storage-navigation-actions">
                  <button type="button" title="Về gốc remote" onClick={() => void loadCloudStorage('')} disabled={!selectedRemote || cloudActionBusy || cloudStorageLoading}><Home size={14} /></button>
                  <button type="button" title="Lên thư mục cha" onClick={() => void loadCloudStorage(parentCloudStoragePath(cloudStoragePath))} disabled={!cloudStoragePath || cloudActionBusy || cloudStorageLoading}><ArrowLeft size={14} /></button>
                  <button type="button" onClick={() => void loadCloudStorage(cloudStoragePath)} disabled={!selectedRemote || cloudActionBusy || cloudStorageLoading}>
                    {cloudStorageLoading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} Tải
                  </button>
                </div>
              </div>
              <p className="cloud-storage-scope-note">
                Token chỉ có quyền một bucket có thể không liệt kê được gốc remote; hãy nhập trực tiếp tên bucket vào ô đường dẫn.
              </p>
            </section>

            <section className="config-section cloud-storage-create-section">
              <div className="cloud-create-folder">
                <label>
                  <span>Tạo thư mục mới tại <code>{cloudStoragePath || `${selectedRemote || 'remote'}:`}</code></span>
                  <input
                    value={cloudNewFolderName}
                    placeholder="Tên thư mục"
                    onChange={(event) => setCloudNewFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void createCloudFolder();
                    }}
                    disabled={!selectedRemote || cloudActionBusy}
                  />
                </label>
                <button type="button" onClick={() => void createCloudFolder()} disabled={!selectedRemote || !cloudNewFolderName.trim() || cloudActionBusy}>
                  <FolderPlus size={14} /> Tạo thư mục
                </button>
              </div>
              <div className="cloud-upload-actions">
                <button type="button" onClick={() => void uploadCloudFiles()} disabled={!selectedRemote || cloudActionBusy}>
                  <Upload size={14} /> Upload file
                </button>
                <button type="button" onClick={() => void uploadCloudFolder()} disabled={!selectedRemote || cloudActionBusy}>
                  <FolderOpen size={14} /> Upload thư mục
                </button>
                <label className="cloud-storage-search">
                  <Search size={13} />
                  <input value={cloudStorageSearch} onChange={(event) => setCloudStorageSearch(event.target.value)} placeholder="Lọc tên trong thư mục…" />
                </label>
              </div>
              {cloudActionMessage && (
                <div className={`cloud-action-feedback ${cloudActionStatus}`}>
                  {cloudActionStatus === 'working' && <LoaderCircle className="spin" size={13} />}
                  {cloudActionStatus === 'success' && <CheckCircle2 size={13} />}
                  {cloudActionStatus === 'failed' && <AlertCircle size={13} />}
                  <span>{cloudActionMessage}</span>
                </div>
              )}
            </section>

            <section className="config-section cloud-storage-list-section">
              <div className="cloud-storage-list-heading">
                <div>
                  <span><HardDrive size={13} /> {selectedRemote ? `${selectedRemote}:${cloudStoragePath}` : 'Chưa chọn remote'}</span>
                  <small>{cloudFolderCount} thư mục · {cloudFileCount} file · {formatBytes(cloudTotalBytes)}</small>
                </div>
                <span>{filteredCloudStorageEntries.length}/{cloudStorageEntries.length} mục</span>
              </div>
              <div className="cloud-storage-table" role="table" aria-label="Nội dung cloud storage">
                <div className="cloud-storage-table-head" role="row">
                  <span>Tên</span><span>Kích thước</span><span>Cập nhật</span>
                </div>
                {cloudStorageLoading ? (
                  <div className="cloud-storage-empty"><LoaderCircle className="spin" size={22} /><strong>Đang đọc object bằng rclone…</strong></div>
                ) : filteredCloudStorageEntries.length > 0 ? (
                  filteredCloudStorageEntries.map((entry) => (
                    <button
                      className={`cloud-storage-row ${selectedCloudStoragePath === entry.path ? 'selected' : ''}`}
                      type="button"
                      role="row"
                      key={entry.path}
                      onClick={() => selectCloudStorageEntry(entry)}
                      onDoubleClick={() => {
                        if (entry.isDirectory) void loadCloudStorage(entry.path);
                      }}
                    >
                      <span className="cloud-storage-name-cell" role="cell">
                        <i>{entry.isDirectory ? <Folder size={15} /> : <FileIcon size={15} />}</i>
                        <b title={entry.name}>{entry.name}</b>
                        {entry.isDirectory && <small>Nhấp đúp để mở</small>}
                      </span>
                      <span role="cell">{entry.isDirectory ? '—' : formatBytes(entry.size)}</span>
                      <span role="cell">{formatCloudDate(entry.modTime)}</span>
                    </button>
                  ))
                ) : (
                  <div className="cloud-storage-empty">
                    <FolderOpen size={24} />
                    <strong>{cloudStorageLoadedRemote ? 'Thư mục trống hoặc không có mục phù hợp.' : 'Nhập bucket / đường dẫn rồi bấm Tải.'}</strong>
                    <span>Thư mục trên object storage là đường dẫn ảo; app dùng file .keep ẩn cho thư mục trống.</span>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="action-bar cloud-storage-action-bar">
            <div className="encode-summary">
              <span><HardDrive size={14} /> {cloudActionBusy ? 'Đang thao tác cloud storage' : `${cloudStorageEntries.length} mục trong thư mục hiện tại`}</span>
              <small>{selectedCloudStorageEntry ? `Đã chọn ${selectedCloudStorageEntry.path}` : 'Chọn một mục để đổi tên, sao chép, di chuyển, tải xuống hoặc xóa'}</small>
            </div>
            <button className="start-button" type="button" onClick={() => void loadCloudStorage(cloudStoragePath)} disabled={!selectedRemote || cloudActionBusy || cloudStorageLoading}>
              <RefreshCw size={15} /> Làm mới
            </button>
          </div>
        </section>

        <aside className="status-panel cloud-storage-inspector-panel">
          <div className="status-heading">
            <div>
              <span className="eyebrow">OBJECT INSPECTOR</span>
              <h2>Chi tiết & thao tác</h2>
            </div>
            <span className={`status-chip ${cloudActionBusy ? 'encoding' : cloudActionStatus === 'failed' ? 'failed' : selectedCloudStorageEntry ? 'completed' : 'idle'}`}>
              <i /> {cloudActionBusy ? 'ĐANG XỬ LÝ' : selectedCloudStorageEntry ? 'ĐÃ CHỌN' : 'CHỜ CHỌN'}
            </span>
          </div>

          <div className="status-content cloud-storage-inspector-content">
            <label className="cloud-public-base-field">
              <span>URL public / CDN của bucket</span>
              <input
                value={publicBaseUrl}
                placeholder="https://cdn.daophim.space"
                onChange={(event) => changePublicBaseUrl(event.target.value)}
                disabled={!selectedRemote || cloudActionBusy}
                spellCheck={false}
              />
              {publicBaseUrlError && <small>{publicBaseUrlError}</small>}
            </label>

            {selectedCloudStorageEntry ? (
              <>
                <div className="cloud-selected-card">
                  <i>{selectedCloudStorageEntry.isDirectory ? <Folder size={25} /> : <FileIcon size={25} />}</i>
                  <div>
                    <span>{selectedCloudStorageEntry.isDirectory ? 'THƯ MỤC' : 'FILE / OBJECT'}</span>
                    <h3 title={selectedCloudStorageEntry.name}>{selectedCloudStorageEntry.name}</h3>
                    <code title={selectedCloudStorageEntry.path}>{selectedCloudStorageEntry.path}</code>
                  </div>
                </div>
                <div className="cloud-selected-meta">
                  <div><span>Kích thước</span><strong>{selectedCloudStorageEntry.isDirectory ? '—' : formatBytes(selectedCloudStorageEntry.size)}</strong></div>
                  <div><span>Cập nhật</span><strong>{formatCloudDate(selectedCloudStorageEntry.modTime)}</strong></div>
                  <div><span>MIME</span><strong>{selectedCloudStorageEntry.mimeType || (selectedCloudStorageEntry.isDirectory ? 'directory' : '—')}</strong></div>
                </div>

                <div className="cloud-primary-actions">
                  {selectedCloudStorageEntry.isDirectory && (
                    <button type="button" onClick={() => void loadCloudStorage(selectedCloudStorageEntry.path)} disabled={cloudActionBusy}><FolderOpen size={13} /> Mở thư mục</button>
                  )}
                  <button type="button" onClick={() => void downloadSelectedCloudEntry()} disabled={cloudActionBusy}><Download size={13} /> Tải xuống</button>
                </div>

                <div className="cloud-operation-block">
                  <label><span>Đổi tên trong thư mục hiện tại</span><input value={cloudRenameName} onChange={(event) => setCloudRenameName(event.target.value)} disabled={cloudActionBusy} /></label>
                  <button type="button" onClick={() => void renameSelectedCloudEntry()} disabled={!cloudRenameName.trim() || cloudRenameName === selectedCloudStorageEntry.name || cloudActionBusy}><Pencil size={12} /> Đổi tên</button>
                </div>
                <div className="cloud-operation-block">
                  <label><span>Sao chép tới đường dẫn đầy đủ</span><input value={cloudCopyDestination} onChange={(event) => setCloudCopyDestination(event.target.value)} disabled={cloudActionBusy} spellCheck={false} /></label>
                  <button type="button" onClick={() => void copySelectedCloudEntry()} disabled={!cloudCopyDestination.trim() || cloudCopyDestination === selectedCloudStorageEntry.path || cloudActionBusy}><Copy size={12} /> Sao chép</button>
                </div>
                <div className="cloud-operation-block">
                  <label><span>Di chuyển tới đường dẫn đầy đủ</span><input value={cloudMoveDestination} onChange={(event) => setCloudMoveDestination(event.target.value)} disabled={cloudActionBusy} spellCheck={false} /></label>
                  <button type="button" onClick={() => void moveSelectedCloudEntry()} disabled={!cloudMoveDestination.trim() || cloudMoveDestination === selectedCloudStorageEntry.path || cloudActionBusy}><ArrowLeft size={12} /> Di chuyển</button>
                </div>

                {(selectedCloudStoragePublicUrl || selectedCloudStorageHlsUrl) && (
                  <div className="cloud-public-links">
                    {selectedCloudStoragePublicUrl && (
                      <div><span>URL public</span><code title={selectedCloudStoragePublicUrl}>{selectedCloudStoragePublicUrl}</code><button type="button" aria-label="Copy URL public" title="Copy URL public" onClick={() => void copyPublicUrl(selectedCloudStoragePublicUrl)}>{copiedPublicUrl === selectedCloudStoragePublicUrl ? <Check size={12} /> : <Copy size={12} />}</button></div>
                    )}
                    {selectedCloudStorageHlsUrl && (
                      <div><span>HLS master</span><code title={selectedCloudStorageHlsUrl}>{selectedCloudStorageHlsUrl}</code><button type="button" aria-label="Copy URL HLS master" title="Copy URL HLS master" onClick={() => void copyPublicUrl(selectedCloudStorageHlsUrl)}>{copiedPublicUrl === selectedCloudStorageHlsUrl ? <Check size={12} /> : <Copy size={12} />}</button></div>
                    )}
                  </div>
                )}

                <div className="cloud-danger-zone">
                  <div><strong>Xóa khỏi cloud storage</strong><span>{selectedCloudStorageEntry.isDirectory ? 'Xóa toàn bộ thư mục và mọi object bên trong.' : 'Xóa vĩnh viễn object đã chọn.'}</span></div>
                  <button className={cloudDeleteArmedPath === selectedCloudStorageEntry.path ? 'armed' : ''} type="button" onClick={() => void deleteSelectedCloudEntry()} disabled={cloudActionBusy}>
                    <Trash2 size={13} /> {cloudDeleteArmedPath === selectedCloudStorageEntry.path ? 'Xác nhận xóa' : 'Xóa'}
                  </button>
                </div>
              </>
            ) : (
              <div className="cloud-inspector-empty">
                <div><HardDrive size={31} /></div>
                <h3>Chọn một file hoặc thư mục</h3>
                <p>Thông tin object, URL public và toàn bộ thao tác CRUD sẽ xuất hiện tại đây.</p>
                <ul>
                  <li><FolderPlus size={12} /> Tạo thư mục ảo trên R2/S3</li>
                  <li><Upload size={12} /> Upload file hoặc nguyên thư mục</li>
                  <li><Pencil size={12} /> Đổi tên, sao chép và di chuyển</li>
                  <li><Download size={12} /> Tải file/thư mục về máy</li>
                  <li><Trash2 size={12} /> Xóa với xác nhận hai bước</li>
                </ul>
              </div>
            )}
          </div>
        </aside>
      </main>
      )}

      {activeTab === 'encode' && isDragging && (
        <div className="drop-overlay">
          <div><FileVideo2 size={38} /><strong>Thả để mở video</strong><span>Đảo Phim Encoding sẽ đọc metadata trước khi encode</span></div>
        </div>
      )}
    </div>
  );
}
