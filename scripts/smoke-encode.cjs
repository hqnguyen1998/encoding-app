const { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { buildEncodeCommand } = require('../dist-electron/electron/encoder/command.js');
const { buildHlsValidationArgs } = require('../dist-electron/electron/encoder/validate.js');
const { inspectHardwareAcceleration } = require('../dist-electron/electron/encoder/hardware.js');
const { exportSubtitleTracks } = require('../dist-electron/electron/subtitles/export.js');

function run(binary, args, label) {
  const result = spawnSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`${label} thất bại:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

const root = mkdtempSync(path.join(tmpdir(), 'dao-phim-encoding-smoke-'));
const inputPath = path.join(root, 'sample.mp4');
const outputPath = path.join(root, 'sample-hls');
const copyOutputPath = path.join(root, 'sample-copy-hls');
const gpuOutputPath = path.join(root, 'sample-gpu-hls');
const advancedOutputPath = path.join(root, 'sample-advanced-fmp4-hls');
const logoPath = path.join(root, 'logo.png');
const logoOutputPath = path.join(root, 'sample-logo-hls');

async function main() {
try {
  run(
    ffmpegPath,
    [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
      '-t', '2.2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', inputPath,
    ],
    'Tạo video mẫu',
  );
  run(
    ffmpegPath,
    [
      '-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=0xffb84d:s=320x120',
      '-frames:v', '1', logoPath,
    ],
    'Tạo logo mẫu',
  );

  const probeJson = run(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
    'Đọc video mẫu',
  );
  const probe = JSON.parse(probeJson);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  mkdirSync(outputPath, { recursive: true });

  const media = {
    path: inputPath,
    name: 'sample.mp4',
    sizeBytes: 0,
    durationSeconds: Number(probe.format.duration),
    width: video.width,
    height: video.height,
    fps: 24,
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    hasAudio: true,
  };
  const config = {
    inputPath,
    outputDirectory: root,
    presetId: 'adaptive-720',
    speedId: 'fast',
    segmentDuration: 2,
  };
  const command = buildEncodeCommand(config, media, outputPath);
  command.renditions.forEach((_, index) => mkdirSync(path.join(outputPath, `v${index}`), { recursive: true }));
  run(ffmpegPath, command.args, 'Encode HLS');

  const master = readFileSync(path.join(outputPath, 'master.m3u8'), 'utf8');
  const variants = (master.match(/#EXT-X-STREAM-INF/g) || []).length;
  if (variants !== 3) throw new Error(`Master playlist có ${variants} rendition, mong đợi 3.`);
  command.renditions.forEach((_, index) => {
    const files = readdirSync(path.join(outputPath, `v${index}`));
    if (!files.includes('index.m3u8') || !files.some((file) => file.endsWith('.ts'))) {
      throw new Error(`Rendition v${index} thiếu playlist hoặc segment.`);
    }
  });

  const advancedCommand = buildEncodeCommand(
    {
      ...config,
      presetId: 'adaptive-720',
      videoEncoderId: 'libx264',
      advanced: {
        videoBitratePercent: 80,
        cpuCrf: 22,
        h264Profile: 'high',
        outputFps: 24,
        keyframeIntervalSeconds: 1,
        scaleAlgorithm: 'bicubic',
        deinterlace: true,
        audioBitrateKbps: 128,
        audioChannels: 2,
        audioSampleRate: 48_000,
        hlsSegmentType: 'fmp4',
        startNumber: 7,
      },
    },
    media,
    advancedOutputPath,
  );
  advancedCommand.renditions.forEach((_, index) => mkdirSync(path.join(advancedOutputPath, `v${index}`), { recursive: true }));
  run(ffmpegPath, advancedCommand.args, 'Encode HLS fMP4 với cấu hình nâng cao');
  advancedCommand.renditions.forEach((_, index) => {
    const variantDirectory = path.join(advancedOutputPath, `v${index}`);
    const advancedFiles = readdirSync(variantDirectory);
    const advancedPlaylist = readFileSync(path.join(variantDirectory, 'index.m3u8'), 'utf8');
    if (
      !advancedFiles.includes(`init_${index}.mp4`) ||
      !advancedFiles.some((file) => file.endsWith('.m4s')) ||
      !advancedPlaylist.includes(`#EXT-X-MAP:URI="init_${index}.mp4"`) ||
      !advancedPlaylist.includes('#EXT-X-MEDIA-SEQUENCE:7')
    ) {
      throw new Error(`Rendition fMP4 nâng cao v${index} thiếu init MP4, segment m4s hoặc start number.`);
    }
  });

  mkdirSync(path.join(logoOutputPath, 'v0'), { recursive: true });
  const logoCommand = buildEncodeCommand(
    {
      ...config,
      presetId: 'single-source',
      logoOverlay: {
        enabled: true,
        path: logoPath,
        position: 'bottom-right',
        widthPercent: 15,
        opacityPercent: 80,
        marginPercent: 2,
      },
    },
    media,
    logoOutputPath,
  );
  run(ffmpegPath, logoCommand.args, 'Encode HLS một chất lượng có đóng logo');
  run(ffmpegPath, buildHlsValidationArgs(logoOutputPath), 'Kiểm tra giải mã HLS có logo');
  if (!readFileSync(path.join(logoOutputPath, 'master.m3u8'), 'utf8').includes('#EXT-X-STREAM-INF')) {
    throw new Error('Encode có logo không tạo được master playlist.');
  }

  const acceleration = await inspectHardwareAcceleration(ffmpegPath);
  const hardwareEncoder = acceleration.encoders.find((encoder) => encoder.hardware);
  if (hardwareEncoder) {
    mkdirSync(gpuOutputPath, { recursive: true });
    const gpuCommand = buildEncodeCommand(
      { ...config, videoEncoderId: hardwareEncoder.id },
      media,
      gpuOutputPath,
    );
    gpuCommand.renditions.forEach((_, index) => mkdirSync(path.join(gpuOutputPath, `v${index}`), { recursive: true }));
    run(ffmpegPath, gpuCommand.args, `Encode HLS bằng ${hardwareEncoder.label}`);
    const gpuMaster = readFileSync(path.join(gpuOutputPath, 'master.m3u8'), 'utf8');
    if ((gpuMaster.match(/#EXT-X-STREAM-INF/g) || []).length !== gpuCommand.renditions.length) {
      throw new Error('GPU encode không tạo đủ rendition trong master playlist.');
    }
  }

  mkdirSync(path.join(copyOutputPath, 'v0'), { recursive: true });
  const copyCommand = buildEncodeCommand(
    { ...config, presetId: 'copy-source' },
    media,
    copyOutputPath,
  );
  if (!copyCommand.args.join(' ').includes('-bsf:v h264_mp4toannexb')) {
    throw new Error('Chế độ Copy MPEG-TS thiếu h264_mp4toannexb.');
  }
  run(ffmpegPath, copyCommand.args, 'Đóng gói HLS bằng Copy video');
  run(ffmpegPath, buildHlsValidationArgs(copyOutputPath), 'Kiểm tra giải mã HLS Copy video');
  const copyMaster = readFileSync(path.join(copyOutputPath, 'master.m3u8'), 'utf8');
  const copyFiles = readdirSync(path.join(copyOutputPath, 'v0'));
  if (!copyMaster.includes('#EXT-X-STREAM-INF') || !copyFiles.includes('index.m3u8') || !copyFiles.some((file) => file.endsWith('.ts'))) {
    throw new Error('Chế độ Copy video thiếu master playlist, variant playlist hoặc segment.');
  }

  const subtitleSourcePath = path.join(root, 'subtitle.srt');
  const subtitledVideoPath = path.join(root, 'sample-with-subtitle.mkv');
  const subtitleOutputDirectory = path.join(root, 'subtitles');
  writeFileSync(
    subtitleSourcePath,
    '1\n00:00:00,000 --> 00:00:01,500\nĐảo Phim Encoding subtitle smoke test.\n',
    'utf8',
  );
  run(
    ffmpegPath,
    [
      '-hide_banner', '-y', '-i', inputPath, '-i', subtitleSourcePath,
      '-map', '0:v:0', '-map', '0:a:0', '-map', '1:0',
      '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'srt',
      '-metadata:s:s:0', 'language=vie', '-metadata:s:s:0', 'title=Vietnamese',
      '-shortest', subtitledVideoPath,
    ],
    'Tạo video có subtitle',
  );
  const subtitleProbe = JSON.parse(
    run(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_streams', subtitledVideoPath],
      'Đọc subtitle track',
    ),
  );
  const subtitleStream = subtitleProbe.streams.find((stream) => stream.codec_type === 'subtitle');
  if (!subtitleStream || subtitleStream.codec_name !== 'subrip') {
    throw new Error('ffprobe không liệt kê được subtitle SRT nhúng.');
  }
  const subtitleTrack = {
    streamIndex: subtitleStream.index,
    ordinal: 0,
    codec: subtitleStream.codec_name,
    language: subtitleStream.tags?.language || null,
    title: subtitleStream.tags?.title || null,
    kind: 'text',
    extension: 'srt',
    formatLabel: 'SRT',
    isDefault: subtitleStream.disposition?.default === 1,
    isForced: subtitleStream.disposition?.forced === 1,
  };
  const subtitleResult = await exportSubtitleTracks(
    ffmpegPath,
    {
      inputPath: subtitledVideoPath,
      outputDirectory: subtitleOutputDirectory,
      streamIndices: [subtitleTrack.streamIndex],
    },
    [subtitleTrack],
  );
  const extractedText = readFileSync(subtitleResult.files[0].path, 'utf8');
  if (!extractedText.includes('Đảo Phim Encoding subtitle smoke test.')) {
    throw new Error('Nội dung subtitle xuất ra không khớp nguồn.');
  }

  console.log(`SMOKE_OK: Copy video HLS có Annex B, HLS một chất lượng có logo, ${variants} rendition adaptive HLS, HLS fMP4 nâng cao${hardwareEncoder ? `, ${hardwareEncoder.label}` : ''} và 1 subtitle SRT đều chính xác.`);
  if (process.env.KEEP_SMOKE_OUTPUT === '1') console.log(`Output: ${outputPath}`);
} finally {
  if (process.env.KEEP_SMOKE_OUTPUT !== '1') rmSync(root, { recursive: true, force: true });
}
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
