import { spawn } from 'node:child_process';
import type {
  HardwareAccelerationStatus,
  VideoEncoderId,
  VideoEncoderOption,
} from '../../shared/types';

type ConcreteVideoEncoderId = Exclude<VideoEncoderId, 'auto'>;

const CPU_ENCODER: VideoEncoderOption = {
  id: 'libx264',
  label: 'CPU · x264',
  hardware: false,
};

const HARDWARE_ENCODERS: Record<Exclude<ConcreteVideoEncoderId, 'libx264'>, VideoEncoderOption> = {
  h264_videotoolbox: { id: 'h264_videotoolbox', label: 'GPU · Apple VideoToolbox', hardware: true },
  h264_nvenc: { id: 'h264_nvenc', label: 'GPU · NVIDIA NVENC', hardware: true },
  h264_qsv: { id: 'h264_qsv', label: 'GPU · Intel Quick Sync', hardware: true },
  h264_amf: { id: 'h264_amf', label: 'GPU · AMD AMF', hardware: true },
};

export function encoderCandidates(platform: NodeJS.Platform): VideoEncoderOption[] {
  if (platform === 'darwin') return [HARDWARE_ENCODERS.h264_videotoolbox];
  if (platform === 'win32') {
    return [HARDWARE_ENCODERS.h264_nvenc, HARDWARE_ENCODERS.h264_qsv, HARDWARE_ENCODERS.h264_amf];
  }
  return [HARDWARE_ENCODERS.h264_nvenc, HARDWARE_ENCODERS.h264_qsv];
}

export function parseAvailableEncoderNames(output: string): Set<string> {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[A-Z.]{6}\s+(\S+)/);
    if (match) names.add(match[1]);
  }
  return names;
}

function runFfmpeg(ffmpegPath: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        resolve({ code: null, stdout });
      }
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code: null, stdout });
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, stdout });
    });
  });
}

async function encoderWorks(ffmpegPath: string, encoderId: ConcreteVideoEncoderId): Promise<boolean> {
  if (encoderId === 'libx264') return true;
  const result = await runFfmpeg(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=128x72:r=1:d=0.1',
    '-frames:v', '1',
    '-an',
    '-c:v', encoderId,
    '-pix_fmt', 'yuv420p',
    '-f', 'null',
    '-',
  ], 8_000);
  return result.code === 0;
}

export async function inspectHardwareAcceleration(
  ffmpegPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<HardwareAccelerationStatus> {
  const encoderList = await runFfmpeg(ffmpegPath, ['-hide_banner', '-encoders'], 8_000);
  const compiled = parseAvailableEncoderNames(encoderList.stdout);
  const hardware: VideoEncoderOption[] = [];

  for (const candidate of encoderCandidates(platform)) {
    if (!compiled.has(candidate.id)) continue;
    if (await encoderWorks(ffmpegPath, candidate.id)) hardware.push(candidate);
  }

  const recommended = hardware[0] ?? CPU_ENCODER;
  return {
    encoders: [CPU_ENCODER, ...hardware],
    recommendedId: recommended.id,
    message: hardware.length > 0
      ? `Đã kiểm tra GPU: ${hardware.map((item) => item.label.replace(/^GPU · /, '')).join(', ')}.`
      : 'Không tìm thấy GPU encoder H.264 hoạt động; app sẽ dùng CPU x264.',
  };
}

export function resolveVideoEncoder(
  requested: VideoEncoderId | undefined,
  status: HardwareAccelerationStatus,
): VideoEncoderOption {
  const id = !requested || requested === 'auto' ? status.recommendedId : requested;
  return status.encoders.find((encoder) => encoder.id === id) ?? CPU_ENCODER;
}
