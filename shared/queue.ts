export type QueueItemStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface QueueLikeItem {
  id: string;
  status: QueueItemStatus;
}

export interface QueueSummary {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  finished: number;
}

export function summarizeQueue(items: QueueLikeItem[]): QueueSummary {
  const summary: QueueSummary = {
    total: items.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    finished: 0,
  };
  for (const item of items) summary[item.status] += 1;
  summary.finished = summary.completed + summary.failed + summary.cancelled;
  return summary;
}

export function nextQueuedItem<T extends QueueLikeItem>(items: T[]): T | null {
  return items.find((item) => item.status === 'queued') ?? null;
}

export function updateQueueItem<T extends QueueLikeItem>(
  items: T[],
  id: string,
  update: Partial<T> | ((item: T) => T),
): T[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    return typeof update === 'function' ? update(item) : { ...item, ...update };
  });
}

export function removeQueueItem<T extends QueueLikeItem>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id || item.status === 'running');
}

export function queueStatusLabel(status: QueueItemStatus): string {
  if (status === 'queued') return 'ĐANG CHỜ';
  if (status === 'running') return 'ĐANG CHẠY';
  if (status === 'completed') return 'HOÀN TẤT';
  if (status === 'failed') return 'CÓ LỖI';
  return 'ĐÃ HỦY';
}
