import { spawn } from 'node:child_process';
import path from 'node:path';

export const HLS_VALIDATION_TIMEOUT_MS = 20_000;

export function buildHlsValidationArgs(outputPath: string): string[] {
  return [
    '-hide_banner',
    '-v',
    'error',
    '-xerror',
    '-i',
    path.join(outputPath, 'master.m3u8'),
    '-map',
    '0:v:0',
    '-t',
    '1',
    '-f',
    'null',
    '-',
  ];
}

export function validateHlsOutput(ffmpegPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, buildHlsValidationArgs(outputPath), {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) {
        finish();
        return;
      }
      const details = stderr.trim();
      finish(new Error(
        details
          ? `HLS đầu ra không thể giải mã. App đã dừng trước khi upload tự động.\n${details}`
          : 'HLS đầu ra không thể giải mã. App đã dừng trước khi upload tự động.',
      ));
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Quá thời gian kiểm tra HLS đầu ra. App đã dừng trước khi upload tự động.'));
    }, HLS_VALIDATION_TIMEOUT_MS);
  });
}
