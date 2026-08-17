export interface PipelineActivity {
  encodeActive: boolean;
  uploadActive: boolean;
  subtitleExportActive: boolean;
}

export function encodeStartBlocker(activity: PipelineActivity): string | null {
  if (activity.encodeActive) return 'Một tác vụ encode khác đang chạy.';
  if (activity.subtitleExportActive) return 'Hãy đợi tác vụ xuất subtitle hoàn tất trước khi encode.';
  return null;
}

export function uploadStartBlocker(activity: PipelineActivity): string | null {
  if (activity.subtitleExportActive) return 'Hãy đợi xuất subtitle hoàn tất trước khi upload.';
  if (activity.uploadActive) return 'Một tác vụ upload khác đang chạy.';
  return null;
}
