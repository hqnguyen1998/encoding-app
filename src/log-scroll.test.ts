import { describe, expect, it } from 'vitest';
import { scrollLogContainerToEnd } from './log-scroll';

describe('scrollLogContainerToEnd', () => {
  it('only updates the log container scroll position', () => {
    const container = { scrollHeight: 840, scrollTop: 12 };

    scrollLogContainerToEnd(container);

    expect(container.scrollTop).toBe(840);
  });

  it('does nothing before the log container is mounted', () => {
    expect(() => scrollLogContainerToEnd(null)).not.toThrow();
  });
});
