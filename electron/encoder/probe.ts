import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { MediaInfo } from '../../shared/types';
import { getSubtitleFormatProfile } from '../../shared/subtitles';

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  tags?: {
    language?: string;
    title?: string;
    handler_name?: string;
  };
  disposition?: {
    default?: number;
    forced?: number;
  };
}

interface FfprobeOutput {
  format?: {
    duration?: string;
  };
  streams?: FfprobeStream[];
}

function parseFrameRate(value?: string): number {
  if (!value) return 0;
  const parts = value.split('/');
  const numerator = Number(parts[0]);
  const denominator = Number(parts[1] ?? '1');
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function runFfprobe(ffprobePath: string, inputPath: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { windowsHide: true },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffprobe đã dừng với mã ${code ?? 'không xác định'}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as FfprobeOutput);
      } catch {
        reject(new Error('Không đọc được metadata của video.'));
      }
    });
  });
}

export async function probeMedia(ffprobePath: string, inputPath: string): Promise<MediaInfo> {
  const fileStat = await stat(inputPath);
  if (!fileStat.isFile()) {
    throw new Error('Nguồn đã chọn không phải là một tệp video.');
  }

  const result = await runFfprobe(ffprobePath, inputPath);
  const streams = result.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const subtitleStreams = streams.filter((stream) => stream.codec_type === 'subtitle');

  if (!video || !video.width || !video.height) {
    throw new Error('Tệp này không có luồng video hợp lệ.');
  }

  const durationSeconds = Number(result.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Không xác định được thời lượng video.');
  }

  const fps = parseFrameRate(video.avg_frame_rate || video.r_frame_rate);
  const subtitleTracks = subtitleStreams.map((stream, ordinal) => {
    const codec = stream.codec_name ?? 'unknown';
    const profile = getSubtitleFormatProfile(codec);
    return {
      streamIndex: stream.index ?? ordinal,
      ordinal,
      codec,
      language: stream.tags?.language?.trim() || null,
      title: stream.tags?.title?.trim() || stream.tags?.handler_name?.trim() || null,
      kind: profile.kind,
      extension: profile.extension,
      formatLabel: profile.formatLabel,
      isDefault: stream.disposition?.default === 1,
      isForced: stream.disposition?.forced === 1,
    };
  });

  return {
    path: inputPath,
    name: path.basename(inputPath),
    sizeBytes: fileStat.size,
    durationSeconds,
    width: video.width,
    height: video.height,
    fps: fps > 0 ? fps : 30,
    videoCodec: video.codec_name ?? 'unknown',
    audioCodec: audio?.codec_name ?? null,
    hasAudio: Boolean(audio),
    subtitleTracks,
  };
}
