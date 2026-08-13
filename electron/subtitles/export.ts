import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getSubtitleFormatProfile } from '../../shared/subtitles';
import type {
  ExportedSubtitleFile,
  SubtitleExportConfig,
  SubtitleExportResult,
  SubtitleTrack,
} from '../../shared/types';
import { safeBaseName } from '../encoder/command';

export interface SubtitleExportPlan {
  args: string[];
  fileName: string;
  outputPath: string;
  format: string;
}

function safeLanguage(language: string | null): string {
  if (!language) return 'und';
  const normalized = language.toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 12);
  return normalized || 'und';
}

async function uniqueOutputPath(directory: string, desiredName: string): Promise<string> {
  const extension = path.extname(desiredName);
  const base = path.basename(desiredName, extension);
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const name = suffix === 0 ? desiredName : `${base}-${suffix + 1}${extension}`;
    const candidate = path.join(directory, name);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`Không thể tạo tên file subtitle duy nhất cho track ${desiredName}.`);
}

export function createSubtitleFileName(inputName: string, track: SubtitleTrack): string {
  const profile = getSubtitleFormatProfile(track.codec);
  return `${safeBaseName(inputName)}.track-${track.streamIndex}.${safeLanguage(track.language)}.${profile.extension}`;
}

export function createSubtitleExportPlan(
  inputPath: string,
  outputPath: string,
  track: SubtitleTrack,
): SubtitleExportPlan {
  const profile = getSubtitleFormatProfile(track.codec);
  const args = [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    '-map',
    `0:${track.streamIndex}`,
    '-vn',
    '-an',
    '-c:s',
    profile.codecMode === 'copy' ? 'copy' : 'srt',
  ];
  if (profile.muxer) args.push('-f', profile.muxer);
  args.push(outputPath);

  return {
    args,
    fileName: path.basename(outputPath),
    outputPath,
    format: profile.formatLabel,
  };
}

function runFfmpeg(ffmpegPath: string, args: string[], track: SubtitleTrack): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = stderr.trim().split(/\r?\n/).slice(-4).join('\n');
        reject(new Error(`Không thể xuất subtitle track ${track.streamIndex}.${detail ? `\n${detail}` : ''}`));
      }
    });
  });
}

export async function exportSubtitleTracks(
  ffmpegPath: string,
  config: SubtitleExportConfig,
  availableTracks: SubtitleTrack[],
): Promise<SubtitleExportResult> {
  const selected = new Set(config.streamIndices);
  const tracks = availableTracks.filter((track) => selected.has(track.streamIndex));
  if (tracks.length === 0) throw new Error('Hãy chọn ít nhất một subtitle track để xuất.');
  if (tracks.length !== selected.size) throw new Error('Danh sách subtitle track không hợp lệ hoặc đã thay đổi.');

  await mkdir(config.outputDirectory, { recursive: true });
  const files: ExportedSubtitleFile[] = [];
  for (const track of tracks) {
    const desiredName = createSubtitleFileName(path.basename(config.inputPath), track);
    const outputPath = await uniqueOutputPath(config.outputDirectory, desiredName);
    const plan = createSubtitleExportPlan(config.inputPath, outputPath, track);
    await runFfmpeg(ffmpegPath, plan.args, track);
    files.push({
      streamIndex: track.streamIndex,
      path: outputPath,
      fileName: plan.fileName,
      format: plan.format,
    });
  }

  return { outputDirectory: config.outputDirectory, files };
}
