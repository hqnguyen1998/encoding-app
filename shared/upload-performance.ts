import type { UploadPerformanceId } from './types';

export interface UploadPerformanceProfile {
  id: UploadPerformanceId;
  name: string;
  description: string;
  transfers: number;
}

export const UPLOAD_PERFORMANCE_PROFILES: UploadPerformanceProfile[] = [
  {
    id: 'stable',
    name: 'Ổn định',
    description: 'Ít RAM · mạng yếu',
    transfers: 4,
  },
  {
    id: 'fast',
    name: 'Nhanh',
    description: 'Khuyên dùng cho HLS',
    transfers: 8,
  },
  {
    id: 'maximum',
    name: 'Tối đa',
    description: 'Mạng mạnh · nhiều RAM',
    transfers: 16,
  },
];

export function resolveUploadPerformance(
  id: UploadPerformanceId | undefined,
): UploadPerformanceProfile {
  return UPLOAD_PERFORMANCE_PROFILES.find((profile) => profile.id === id)
    ?? UPLOAD_PERFORMANCE_PROFILES[1];
}
