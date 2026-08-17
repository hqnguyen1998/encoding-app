import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Captions,
  Clock3,
  CloudUpload,
  Cpu,
  Download,
  FileVideo2,
  Film,
  Folder,
  FolderOpen,
  Gauge,
  ImageIcon,
  Layers3,
  Link2,
  ListOrdered,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  ExternalLink,
  X,
  Zap,
} from 'lucide-react';
import { PRESETS, SPEEDS } from '../shared/presets';
import { DEFAULT_ADVANCED_ENCODE_SETTINGS } from '../shared/encode-settings';
import { DEFAULT_LOGO_OVERLAY_SETTINGS } from '../shared/logo-overlay';
import { scrollLogContainerToEnd } from './log-scroll';
import { localMediaUrl } from './local-media-url';
import { logoPreviewStyle } from './logo-preview';
import { loadAppPreferences, saveAppPreferences } from './preferences';
import {
  nextQueuedItem,
  queueStatusLabel,
  removeQueueItem,
  summarizeQueue,
  updateQueueItem,
  type QueueItemStatus,
} from '../shared/queue';
import type {
  AdvancedEncodeSettings,
  EncodeConfig,
  EncodeEvent,
  EncodeProgress,
  HardwareAccelerationStatus,
  LogoOverlaySettings,
  MediaInfo,
  OnzloadSessionState,
  OnzloadUploadEvent,
  PresetId,
  RcloneUploadPerformanceId,
  RcloneUploadProgress,
  SpeedId,
  VideoEncoderId,
} from '../shared/types';

type AppStatus = 'idle' | 'probing' | 'ready' | 'encoding' | 'completed' | 'failed' | 'cancelled';
type SubtitleExportStatus = 'idle' | 'exporting' | 'success' | 'failed';
type AppTab = 'encode' | 'onzload';

interface EncodeQueueItem {
  id: string;
  media: MediaInfo;
  status: QueueItemStatus;
  config: EncodeConfig | null;
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

const ACCEPTED_EXTENSIONS = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'mts'];
const LOGO_POSITIONS: Array<{ id: LogoOverlaySettings['position']; label: string }> = [
  { id: 'top-left', label: 'Trên trái' },
  { id: 'top-right', label: 'Trên phải' },
  { id: 'bottom-left', label: 'Dưới trái' },
  { id: 'bottom-right', label: 'Dưới phải' },
  { id: 'center', label: 'Chính giữa' },
];

function createQueueId(prefix: 'encode' | 'onzload'): string {
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
  const uploadPerformanceId: RcloneUploadPerformanceId = savedPreferences.upload.performanceId;
  const [localHlsPath, setLocalHlsPath] = useState('');
  const [encodeQueue, setEncodeQueue] = useState<EncodeQueueItem[]>([]);
  const [onzloadQueue, setOnzloadQueue] = useState<OnzloadQueueItem[]>([]);
  const [encodeQueueRunning, setEncodeQueueRunning] = useState(false);
  const [activeEncodeQueueItemId, setActiveEncodeQueueItemId] = useState<string | null>(null);
  const [onzloadQueueRunning, setOnzloadQueueRunning] = useState(false);
  const [activeOnzloadQueueItemId, setActiveOnzloadQueueItemId] = useState<string | null>(null);
  const [onzloadBaseUrl, setOnzloadBaseUrl] = useState('https://onzload.com');
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
  const dropDepth = useRef(0);
  const logOutputRef = useRef<HTMLDivElement>(null);
  const encodeQueueRef = useRef<EncodeQueueItem[]>([]);
  const onzloadQueueRef = useRef<OnzloadQueueItem[]>([]);
  const activeEncodeQueueItemIdRef = useRef<string | null>(null);
  const activeOnzloadQueueItemIdRef = useRef<string | null>(null);

  const replaceEncodeQueue = useCallback((updater: (items: EncodeQueueItem[]) => EncodeQueueItem[]) => {
    const next = updater(encodeQueueRef.current);
    encodeQueueRef.current = next;
    setEncodeQueue(next);
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

  const setActiveOnzloadQueueItem = useCallback((id: string | null) => {
    activeOnzloadQueueItemIdRef.current = id;
    setActiveOnzloadQueueItemId(id);
  }, []);

  const isSubtitleExporting = subtitleExportStatus === 'exporting';
  const isBusy = status === 'probing' || status === 'encoding' || isSubtitleExporting || encodeQueueRunning;
  const encodeQueueSummary = useMemo(() => summarizeQueue(encodeQueue), [encodeQueue]);
  const onzloadQueueSummary = useMemo(() => summarizeQueue(onzloadQueue), [onzloadQueue]);
  const canProcessEncodeQueue = encodeQueueRunning && !activeEncodeQueueItemId && !isSubtitleExporting;
  const canStart = Boolean(
    encodeQueueSummary.queued > 0 &&
    outputDirectory &&
    (!logoOverlay.enabled || (logoOverlay.path && presetId !== 'copy-source')) &&
    (!uploadAfterEncodeOnzload || onzloadSession.connected) &&
    !isSubtitleExporting,
  );
  const selectedPreset = PRESETS.find((item) => item.id === presetId)!;
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
        performanceId: uploadPerformanceId,
      },
    });
  }, [
    activeTab,
    advancedSettings,
    logoOverlay,
    outputDirectory,
    presetId,
    segmentDuration,
    showAdvancedSettings,
    speedId,
    uploadPerformanceId,
    videoEncoderId,
  ]);

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
  }, [enqueueOnzloadPath, replaceEncodeQueue, setActiveEncodeQueueItem]);

  useEffect(() => {
    void refreshOnzload();
  }, [refreshOnzload]);

  useEffect(() => {
    window.localStorage.removeItem('dao-encoding:onzload-url');
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith('dao-phim:public-base-url:')) window.localStorage.removeItem(key);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('dao-encoding:onzload-auto', String(uploadAfterEncodeOnzload));
  }, [uploadAfterEncodeOnzload]);

  useEffect(() => {
    void refreshHardwareAcceleration();
  }, [refreshHardwareAcceleration]);

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
    if (showLogs) scrollLogContainerToEnd(logOutputRef.current);
  }, [logs, showLogs]);

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

  const removeEncodeQueueItem = (id: string) => {
    replaceEncodeQueue((items) => removeQueueItem(items, id));
  };

  const retryEncodeQueueItem = (id: string) => {
    replaceEncodeQueue((items) => updateQueueItem(items, id, {
      status: 'queued',
      config: null,
      autoUploadOnzload: false,
      jobId: null,
      outputPath: '',
      progress: null,
      videoEncoderLabel: '',
      error: '',
    }));
    setStatus('ready');
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

  const chooseAndUploadOnzloadFolders = async () => {
    if (!onzloadSession.connected || onzloadQueueRunning) return;
    const folders = await window.encoder.selectHlsFolders();
    const added = folders.reduce(
      (count, folder) => count + (enqueueOnzloadPath(folder) ? 1 : 0),
      0,
    );
    if (added > 0) setOnzloadQueueRunning(true);
  };

  const cancelOnzloadUpload = async () => {
    setOnzloadQueueRunning(false);
    const item = activeOnzloadQueueItemIdRef.current
      ? onzloadQueueRef.current.find((candidate) => candidate.id === activeOnzloadQueueItemIdRef.current)
      : null;
    if (item?.jobId) await window.encoder.cancelOnzloadUpload(item.jobId);
  };

  useEffect(() => {
    if (!canProcessEncodeQueue) return;

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
    canProcessEncodeQueue,
    encodeQueue,
    replaceEncodeQueue,
    setActiveEncodeQueueItem,
  ]);

  useEffect(() => {
    if (
      !onzloadQueueRunning ||
      activeOnzloadQueueItemId ||
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
  };

  const openUploadTab = (sourcePath = '') => {
    if (sourcePath) {
      const added = enqueueOnzloadPath(sourcePath, media?.name ?? '');
      if (added && onzloadSession.connected) setOnzloadQueueRunning(true);
    }
    setActiveTab('onzload');
  };

  const progressStyle = useMemo(
    () => ({ '--progress': `${progress?.percent ?? 0}%` }) as React.CSSProperties,
    [progress?.percent],
  );
  const activeOnzloadItem = onzloadQueue.find((item) => item.status === 'running')
    ?? [...onzloadQueue].reverse().find((item) => item.status === 'completed' || item.status === 'failed')
    ?? null;

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
            className={activeTab === 'onzload' ? 'active' : ''}
            onClick={() => openUploadTab()}
          >
            <CloudUpload size={13} /> Upload OnzLoad
            {onzloadQueueSummary.queued > 0
              ? <b className="tab-queue-count">{onzloadQueueSummary.queued}</b>
              : onzloadSession.connected && <i />}
          </button>
        </nav>
        <div className="privacy-note">
          <span className="privacy-dot" />
          Encode trên máy · lưu trên OnzLoad
        </div>
      </header>

      {activeTab === 'encode' ? (
      <main className="workspace">
        <section className="config-panel">
          <div className="section-heading hero-heading">
            <div>
              <span className="eyebrow">NEW ENCODE</span>
              <h1>Biến video thành HLS.</h1>
              <p>Encode cục bộ, sau đó upload HLS thẳng lên tài khoản OnzLoad.</p>
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
              <small>{selectedPreset.name} · {renditionSummary(media, presetId)} · {selectedVideoEncoderLabel} · segment {segmentDuration}s{logoOverlay.enabled ? ` · logo ${logoOverlay.widthPercent}%` : ''}{hasCustomAdvancedSettings ? ' · nâng cao' : ''}{uploadAfterEncodeOnzload ? ' · tự tạo video OnzLoad' : ''}</small>
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
                      <CloudUpload size={15} /> Upload lên OnzLoad
                    </button>
                    <button type="button" onClick={resetJob}>
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
              <span><Terminal size={15} /> Nhật ký FFmpeg <em>{logs.length}</em></span>
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
      ) : activeTab === 'onzload' ? (
      <main className="workspace upload-workspace onzload-only-workspace">
        <section className="config-panel upload-config-panel">
          <div className="section-heading hero-heading upload-hero-heading">
            <div>
              <span className="eyebrow">ONZLOAD DESKTOP UPLOAD</span>
              <h1>Encode xong, upload ngay.</h1>
              <p>Không cần endpoint, bucket hay Access Key. OnzLoad tự chọn storage và tạo video.</p>
            </div>
            <CloudUpload className="upload-hero-icon" size={35} strokeWidth={1.35} />
          </div>

          <div className="config-scroll upload-config-scroll">
            <section className="config-section onzload-section">
              <div className="config-label">
                <span>01</span>
                <div>
                  <h2>Liên kết tài khoản OnzLoad</h2>
                  <p>Đăng nhập qua trình duyệt; encoder chỉ lưu token thiết bị đã mã hóa</p>
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
                <div className="onzload-server-row">
                  <div>
                    <span>Máy chủ upload</span>
                    <strong>{onzloadSession.baseUrl || 'https://onzload.com'}</strong>
                    <small>Storage được quản lý tập trung trên OnzLoad</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => void (onzloadSession.connected ? disconnectOnzload() : connectOnzload())}
                    disabled={onzloadAuthBusy || onzloadQueueRunning}
                  >
                    {onzloadAuthBusy ? <LoaderCircle className="spin" size={14} /> : onzloadSession.connected ? <X size={14} /> : <ExternalLink size={14} />}
                    {onzloadAuthBusy ? 'Đang xử lý…' : onzloadSession.connected ? 'Đăng xuất' : 'Đăng nhập OnzLoad'}
                  </button>
                </div>
                <p className="onzload-session-message">
                  {onzloadSession.message}
                  {onzloadSession.capabilities ? ` · Tối đa ${onzloadSession.capabilities.upload.maxFileSizeLabel}/video` : ''}
                </p>
              </div>
            </section>

            <section className="config-section onzload-upload-section">
              <div className="config-label">
                <span>02</span>
                <div>
                  <h2>Encode rồi upload</h2>
                  <p>Chọn tự động sau encode hoặc upload một thư mục HLS đã có</p>
                </div>
              </div>

              <div className="onzload-simple-actions">
                <label className="auto-upload-toggle">
                  <input
                    type="checkbox"
                    checked={uploadAfterEncodeOnzload}
                    onChange={(event) => {
                      if (event.target.checked && !onzloadSession.connected) return;
                      setUploadAfterEncodeOnzload(event.target.checked);
                    }}
                    disabled={encodeQueueRunning}
                  />
                  <span>
                    <b>Tự upload và tạo video sau mỗi encode</b>
                    <small>Đầu ra được chuẩn hóa H.264/yuv420p + AAC stereo 48 kHz theo OnzLoad</small>
                  </span>
                </label>
                <div className="onzload-upload-buttons">
                  <button
                    type="button"
                    onClick={() => void chooseAndUploadOnzloadFolders()}
                    disabled={!onzloadSession.connected || onzloadQueueRunning}
                  >
                    <FolderOpen size={14} /> Chọn HLS và upload
                  </button>
                  <button
                    type="button"
                    className="onzload-upload-now"
                    onClick={uploadCurrentFolderToOnzload}
                    disabled={!onzloadSession.connected || !localHlsPath || onzloadQueueRunning}
                  >
                    <CloudUpload size={14} /> Upload kết quả gần nhất
                  </button>
                </div>
              </div>

              <div className="onzload-security-note">
                <ShieldCheck size={16} />
                <div>
                  <strong>Không có khóa hoặc cấu hình R2 trên máy người dùng</strong>
                  <span>Mỗi video chỉ nhận quyền upload tạm thời cho đúng thư mục do OnzLoad cấp.</span>
                </div>
              </div>

              {onzloadQueue.length > 0 && (
                <div className="queue-card onzload-queue-card">
                  <div className="queue-card-heading">
                    <span><ListOrdered size={14} /> Hàng đợi OnzLoad <em>{onzloadQueue.length}</em></span>
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
                          <small title={item.sourcePath}>{item.destination || baseNameOf(item.sourcePath)}</small>
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
                          {item.status !== 'running' && <button type="button" title="Xóa khỏi hàng đợi" onClick={() => removeOnzloadQueueItem(item.id)} disabled={onzloadQueueRunning}><X size={12} /></button>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="action-bar upload-action-bar">
            <div className="encode-summary">
              <span><ListOrdered size={14} /> {onzloadQueueSummary.queued} chờ · {onzloadQueueSummary.completed} xong · {onzloadQueueSummary.failed} lỗi</span>
              <small>{onzloadSession.connected ? 'OnzLoad tự quản lý R2 và tự tạo database sau upload' : 'Đăng nhập OnzLoad để bắt đầu upload'}</small>
            </div>
            {onzloadQueueRunning ? (
              <button className="cancel-button" type="button" onClick={() => void cancelOnzloadUpload()}>
                <Pause size={15} fill="currentColor" /> Dừng upload
              </button>
            ) : onzloadQueueSummary.queued > 0 ? (
              <button
                className="start-button upload-start-button"
                type="button"
                onClick={() => setOnzloadQueueRunning(true)}
                disabled={!onzloadSession.connected}
              >
                <CloudUpload size={17} /> Upload hàng đợi ({onzloadQueueSummary.queued})
              </button>
            ) : (
              <button
                className="start-button upload-start-button"
                type="button"
                onClick={() => void chooseAndUploadOnzloadFolders()}
                disabled={!onzloadSession.connected}
              >
                <CloudUpload size={17} /> Chọn HLS để upload
              </button>
            )}
          </div>
        </section>

        <aside className="status-panel upload-status-panel">
          <div className="status-heading">
            <div>
              <span className="eyebrow">ONZLOAD STATUS</span>
              <h2>Tiến trình upload</h2>
            </div>
            <span className={`status-chip ${activeOnzloadItem?.status === 'running' ? 'encoding' : activeOnzloadItem?.status ?? 'idle'}`}>
              <i />
              {activeOnzloadItem ? queueStatusLabel(activeOnzloadItem.status).toUpperCase() : 'CHỜ TÁC VỤ'}
            </span>
          </div>

          <div className="status-content upload-status-content">
            <div className={`upload-visual-state ${activeOnzloadItem?.status === 'completed' ? 'success' : activeOnzloadItem?.status ?? 'idle'}`}>
              <div className="upload-cloud-orbit">
                {activeOnzloadItem?.status === 'running'
                  ? <LoaderCircle className="spin" size={35} />
                  : activeOnzloadItem?.status === 'completed'
                    ? <CheckCircle2 size={35} />
                    : activeOnzloadItem?.status === 'failed'
                      ? <AlertCircle size={35} />
                      : <CloudUpload size={35} />}
              </div>
              <span>{activeOnzloadItem?.status === 'running' ? 'Đang upload lên OnzLoad' : activeOnzloadItem?.status === 'completed' ? 'Video đã sẵn sàng' : activeOnzloadItem?.status === 'failed' ? 'Upload chưa hoàn tất' : 'Sẵn sàng upload'}</span>
              <h3 title={activeOnzloadItem?.sourcePath}>{activeOnzloadItem?.originalName || 'Encode một video để bắt đầu'}</h3>
              <p>{activeOnzloadItem?.error || (onzloadSession.connected ? 'OnzLoad sẽ tự chọn storage, kiểm tra file và tạo video.' : 'Hãy đăng nhập tài khoản OnzLoad.')}</p>
            </div>

            {activeOnzloadItem?.progress && (
              <div className="upload-progress-card">
                <div className="upload-progress-number">
                  <strong>{Math.round(activeOnzloadItem.progress.percent)}%</strong>
                  <span>{activeOnzloadItem.progress.files} / {activeOnzloadItem.progress.totalFiles || '—'} file</span>
                </div>
                <div className="upload-progress-track"><span style={{ width: `${activeOnzloadItem.progress.percent}%` }} /></div>
                <div className="upload-progress-meta">
                  <span>{formatBytes(activeOnzloadItem.progress.bytes)} / {activeOnzloadItem.progress.totalBytes ? formatBytes(activeOnzloadItem.progress.totalBytes) : 'đang tính'}</span>
                  <span>{formatBytes(activeOnzloadItem.progress.speedBytesPerSecond)}/s</span>
                  <span>ETA {formatDuration(activeOnzloadItem.progress.etaSeconds)}</span>
                </div>
              </div>
            )}

            {activeOnzloadItem?.embedUrl && (
              <div className="public-url-result">
                <div>
                  <span><CheckCircle2 size={12} /> Video OnzLoad đã được tạo</span>
                  <code title={activeOnzloadItem.embedUrl}>{activeOnzloadItem.embedUrl}</code>
                </div>
                <span className="public-url-actions">
                  <button type="button" onClick={() => void window.encoder.copyText(activeOnzloadItem.embedUrl)}><Copy size={13} /> Sao chép</button>
                  <button type="button" onClick={() => void window.encoder.openExternal(activeOnzloadItem.embedUrl)}><ExternalLink size={13} /> Mở video</button>
                </span>
              </div>
            )}

            <div className="upload-route-card onzload-route-card">
              <div><span>Máy người dùng</span><strong>Encode HLS</strong></div>
              <i />
              <div><span>OnzLoad</span><strong>Upload · Storage · Database</strong></div>
            </div>
          </div>

          <div className={`log-panel ${showLogs ? 'expanded' : ''}`}>
            <button className="log-toggle" type="button" onClick={() => setShowLogs((current) => !current)}>
              <span><Terminal size={15} /> Nhật ký upload <em>{onzloadLogs.length}</em></span>
              <ChevronDown size={16} />
            </button>
            {showLogs && (
              <div className="log-output" ref={logOutputRef}>
                {onzloadLogs.length === 0 ? <span className="log-empty">Chưa có dữ liệu log.</span> : onzloadLogs.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}
              </div>
            )}
          </div>
        </aside>
      </main>
      ) : null}

      {activeTab === 'encode' && isDragging && (
        <div className="drop-overlay">
          <div><FileVideo2 size={38} /><strong>Thả để mở video</strong><span>Đảo Phim Encoding sẽ đọc metadata trước khi encode</span></div>
        </div>
      )}
    </div>
  );
}
