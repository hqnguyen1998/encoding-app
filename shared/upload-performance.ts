import type { RcloneUploadPerformanceId } from './types';

export interface RcloneUploadPerformanceProfile {
  id: RcloneUploadPerformanceId;
  name: string;
  description: string;
  transfers: number;
  checkers: number;
  bufferSize: string;
}

export const RCLONE_UPLOAD_PERFORMANCE_PROFILES: RcloneUploadPerformanceProfile[] = [
  {
    id: 'stable',
    name: 'Ổn định',
    description: 'Ít RAM · mạng yếu',
    transfers: 8,
    checkers: 16,
    bufferSize: '16M',
  },
  {
    id: 'fast',
    name: 'Nhanh',
    description: 'Khuyên dùng cho HLS',
    transfers: 24,
    checkers: 32,
    bufferSize: '8M',
  },
  {
    id: 'maximum',
    name: 'Tối đa',
    description: 'Mạng mạnh · nhiều RAM',
    transfers: 32,
    checkers: 64,
    bufferSize: '8M',
  },
];

export function resolveRcloneUploadPerformance(
  id: RcloneUploadPerformanceId | undefined,
): RcloneUploadPerformanceProfile {
  return RCLONE_UPLOAD_PERFORMANCE_PROFILES.find((profile) => profile.id === id)
    ?? RCLONE_UPLOAD_PERFORMANCE_PROFILES[1];
}
