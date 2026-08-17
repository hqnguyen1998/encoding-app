import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadRemoteHls, findPlaylistReferences } from './download';

const cleanupPaths: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

async function createOutputParent(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), 'dao-phim-hls-test-'));
  cleanupPaths.push(target);
  return target;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Không thể mở test server.');
  return address.port;
}

describe('findPlaylistReferences', () => {
  it('finds media lines and every quoted URI attribute without changing inline data', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-SESSION-DATA:DATA-ID="x",URI="meta.json"',
      'video/segment 01.ts?token=secret',
      '',
    ].join('\n');
    expect(findPlaylistReferences(playlist).map((item) => item.raw)).toEqual([
      'keys/key.bin',
      'init.mp4',
      'meta.json',
      'video/segment 01.ts?token=secret',
    ]);
  });
});

describe('downloadRemoteHls', () => {
  it('downloads and rewrites a signed multi-playlist HLS tree as master.m3u8', async () => {
    const tokenSegment = 'bcdn_token=private-token&expires=9999999999&token_path=%2Fasset%2F';
    const requestedPaths: string[] = [];
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      requestedPaths.push(requestUrl.pathname);
      const logicalPath = requestUrl.pathname.replace(`/${tokenSegment}`, '');
      const playlists: Record<string, string> = {
        '/asset/playlist.m3u8': [
          '#EXTM3U',
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="/asset/audio/audio.m3u8"',
          '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"',
          '#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="audio"',
          'video/index.m3u8',
          '',
        ].join('\n'),
        '/asset/video/index.m3u8': [
          '#EXTM3U',
          '#EXT-X-MAP:URI="../init.mp4"',
          '#EXTINF:6,',
          'segment%2001.ts',
          '#EXT-X-ENDLIST',
          '',
        ].join('\n'),
        '/asset/audio/audio.m3u8': [
          '#EXTM3U',
          '#EXTINF:6,',
          'audio-001.aac',
          '#EXT-X-ENDLIST',
          '',
        ].join('\n'),
      };
      if (playlists[logicalPath]) {
        response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        response.end(playlists[logicalPath]);
        return;
      }
      if (['/asset/key.bin', '/asset/init.mp4', '/asset/video/segment%2001.ts', '/asset/audio/audio-001.aac'].includes(logicalPath)) {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        response.end(`bytes:${logicalPath}`);
        return;
      }
      response.writeHead(404).end();
    });
    const port = await listen(server);
    const outputParentDirectory = await createOutputParent();
    const rootUrl = `http://127.0.0.1:${port}/${tokenSegment}/asset/playlist.m3u8`;

    const result = await downloadRemoteHls(
      { url: rootUrl, folderName: 'my-film-hls' },
      { outputParentDirectory, concurrency: 3 },
    );

    expect(result.fileCount).toBe(7);
    expect(result.outputPath).toBe(path.join(outputParentDirectory, 'my-film-hls'));
    const master = await readFile(result.rootPlaylistPath, 'utf8');
    const video = await readFile(path.join(result.outputPath, 'video/index.m3u8'), 'utf8');
    expect(master).toContain('URI="audio/audio.m3u8"');
    expect(master).toContain('URI="key.bin"');
    expect(master).toContain('video/index.m3u8');
    expect(master).not.toContain('private-token');
    expect(video).toContain('URI="../init.mp4"');
    expect(video).toContain('segment-01.ts');
    expect(await readFile(path.join(result.outputPath, 'video/segment-01.ts'), 'utf8'))
      .toBe('bytes:/asset/video/segment%2001.ts');
    expect(requestedPaths.every((requestedPath) => requestedPath.startsWith(`/${tokenSegment}/asset/`))).toBe(true);
  });

  it('propagates a signed root query to relative resources', async () => {
    const seenQueries: string[] = [];
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      seenQueries.push(requestUrl.search);
      if (requestUrl.pathname.endsWith('master.m3u8')) {
        response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        response.end('#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n');
      } else {
        response.writeHead(200, { 'Content-Type': 'video/mp2t' });
        response.end('segment');
      }
    });
    const port = await listen(server);
    const outputParentDirectory = await createOutputParent();
    await downloadRemoteHls(
      { url: `http://127.0.0.1:${port}/movie/master.m3u8?token=signed` },
      { outputParentDirectory },
    );
    expect(seenQueries).toEqual(['?token=signed', '?token=signed']);
  });

  it('finishes when low-latency rendition reports reference each other', async () => {
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const playlists: Record<string, string> = {
        '/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nb.m3u8\n',
        '/a.m3u8': '#EXTM3U\n#EXT-X-RENDITION-REPORT:URI="b.m3u8"\n#EXT-X-ENDLIST\n',
        '/b.m3u8': '#EXTM3U\n#EXT-X-RENDITION-REPORT:URI="a.m3u8"\n#EXT-X-ENDLIST\n',
      };
      response.writeHead(playlists[pathname] ? 200 : 404, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end(playlists[pathname] ?? 'not found');
    });
    const port = await listen(server);
    const outputParentDirectory = await createOutputParent();
    const result = await downloadRemoteHls(
      { url: `http://127.0.0.1:${port}/master.m3u8` },
      { outputParentDirectory, concurrency: 2 },
    );
    expect(result.fileCount).toBe(3);
    expect(await readFile(path.join(result.outputPath, 'a.m3u8'), 'utf8')).toContain('URI="b.m3u8"');
    expect(await readFile(path.join(result.outputPath, 'b.m3u8'), 'utf8')).toContain('URI="a.m3u8"');
  });

  it('reports an HTTP error without exposing the signed URL', async () => {
    const server = createServer((_request, response) => response.writeHead(403, 'Forbidden').end('denied'));
    const port = await listen(server);
    const outputParentDirectory = await createOutputParent();
    const signedUrl = `http://127.0.0.1:${port}/master.m3u8?token=do-not-log`;
    await expect(downloadRemoteHls({ url: signedUrl }, { outputParentDirectory }))
      .rejects.toThrow('HTTP 403 Forbidden');
    await expect(downloadRemoteHls({ url: signedUrl, folderName: 'second' }, { outputParentDirectory }))
      .rejects.not.toThrow('do-not-log');
  });
});
