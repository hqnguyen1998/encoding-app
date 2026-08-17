import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { presignRequestFiles, scanHlsFolder, uploadSignedFile } from './upload';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('OnzLoad direct upload', () => {
  it('scans only supported HLS files and sends no local path to OnzLoad', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'onzload-upload-test-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'v0'));
    await writeFile(path.join(root, 'master.m3u8'), '#EXTM3U\n');
    await writeFile(path.join(root, 'v0', 'index.m3u8'), '#EXTM3U\n#EXTINF:2,\nsegment.ts\n');
    await writeFile(path.join(root, 'v0', 'segment.ts'), Buffer.alloc(256, 7));
    await writeFile(path.join(root, 'ignore.txt'), 'not uploaded');

    const result = await scanHlsFolder(root);
    expect(result.fileCount).toBe(3);
    expect(result.files.map((file) => file.relativePath)).toEqual([
      'master.m3u8',
      'v0/index.m3u8',
      'v0/segment.ts',
    ]);
    expect(presignRequestFiles(result.files)).toEqual(result.files.map((file) => ({
      relativePath: file.relativePath,
      size: file.size,
    })));
    expect(JSON.stringify(presignRequestFiles(result.files))).not.toContain(root);
  });

  it('PUTs a file through a server-issued URL and reports bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'onzload-put-test-'));
    temporaryDirectories.push(root);
    const absolutePath = path.join(root, 'master.m3u8');
    const content = Buffer.concat([
      Buffer.from('#EXTM3U\n#EXT-X-ENDLIST\n'),
      Buffer.alloc(2 * 1024 * 1024, 7),
    ]);
    await writeFile(absolutePath, content);

    let received = Buffer.alloc(0);
    let receivedContentType = '';
    const server = createServer((request, response) => {
      receivedContentType = request.headers['content-type'] ?? '';
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received = Buffer.concat(chunks);
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server không có port.');
      const progress: number[] = [];
      await uploadSignedFile(
        { absolutePath, relativePath: 'master.m3u8', size: content.length },
        {
          relativePath: 'master.m3u8',
          size: content.length,
          uploadUrl: `http://127.0.0.1:${address.port}/signed-put`,
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        },
        new AbortController().signal,
        (bytes) => progress.push(bytes),
      );
      expect(received).toEqual(content);
      expect(receivedContentType).toBe('application/vnd.apple.mpegurl');
      expect(progress.at(-1)).toBe(content.length);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
