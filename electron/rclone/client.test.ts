import { describe, expect, it } from 'vitest';
import { explainRcloneFailure } from './client';

describe('rclone error explanation', () => {
  it('explains an R2 signature mismatch without exposing the raw backend error', () => {
    const message = explainRcloneFailure(
      'api error SignatureDoesNotMatch: The request signature does not match',
      '',
      1,
    );

    expect(message).toContain('Access Key ID');
    expect(message).toContain('Secret Access Key');
    expect(message).toContain('token mới');
    expect(message).not.toContain('api error');
  });

  it('explains bucket and permission errors', () => {
    expect(explainRcloneFailure('NoSuchBucket', '', 1)).toContain('tên bucket');
    expect(explainRcloneFailure('AccessDenied', '', 1)).toContain('Object Read & Write');
  });
});
