import { describe, expect, it } from 'vitest';
import {
  nextQueuedItem,
  removeQueueItem,
  summarizeQueue,
  updateQueueItem,
} from './queue';

const items = [
  { id: 'a', status: 'completed' as const },
  { id: 'b', status: 'queued' as const },
  { id: 'c', status: 'running' as const },
  { id: 'd', status: 'failed' as const },
];

describe('queue helpers', () => {
  it('summarizes pending and finished work', () => {
    expect(summarizeQueue(items)).toMatchObject({
      total: 4,
      queued: 1,
      running: 1,
      completed: 1,
      failed: 1,
      finished: 2,
    });
  });

  it('returns the first queued item in insertion order', () => {
    expect(nextQueuedItem(items)?.id).toBe('b');
  });

  it('updates only the requested item', () => {
    expect(updateQueueItem(items, 'b', { status: 'running' })[1].status).toBe('running');
    expect(updateQueueItem(items, 'b', { status: 'running' })[0]).toEqual(items[0]);
  });

  it('never removes a running item', () => {
    expect(removeQueueItem(items, 'b').some((item) => item.id === 'b')).toBe(false);
    expect(removeQueueItem(items, 'c').some((item) => item.id === 'c')).toBe(true);
  });
});
