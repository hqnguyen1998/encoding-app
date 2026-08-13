import { describe, expect, it } from 'vitest';
import {
  parseRcloneConfigPath,
  upsertRcloneConfig,
  validateRcloneRemoteConfig,
} from './config';

const cloudflareConfig = {
  name: 'dao-r2',
  provider: 'Cloudflare' as const,
  accessKeyId: 'access-example',
  secretAccessKey: 'secret-example',
  endpoint: 'https://account-id.r2.cloudflarestorage.com',
  region: 'auto',
};

describe('rclone config', () => {
  it('adds an S3 remote while preserving existing remotes', () => {
    const result = upsertRcloneConfig('[keep]\ntype = local\nnounc = true\n', cloudflareConfig);
    expect(result).toContain('[keep]\ntype = local\nnounc = true');
    expect(result).toContain('[dao-r2]\ntype = s3\nprovider = Cloudflare');
    expect(result).toContain('secret_access_key = secret-example');
    expect(result).toContain('no_check_bucket = true');
  });

  it('does not force the Cloudflare bucket workaround for other S3 providers', () => {
    const result = upsertRcloneConfig('', {
      ...cloudflareConfig,
      provider: 'Other',
    });

    expect(result).not.toContain('no_check_bucket');
  });

  it('replaces only the matching remote section', () => {
    const existing = '[dao-r2]\ntype = s3\nendpoint = https://old.example\n\n[keep]\ntype = local\n';
    const result = upsertRcloneConfig(existing, cloudflareConfig);
    expect(result.match(/\[dao-r2\]/g)).toHaveLength(1);
    expect(result).not.toContain('old.example');
    expect(result).toContain('[keep]\ntype = local');
  });

  it('requires an endpoint for R2 and compatible S3 providers', () => {
    expect(() => validateRcloneRemoteConfig({ ...cloudflareConfig, endpoint: '' }))
      .toThrow('Hãy nhập endpoint');
  });

  it('parses the path returned by rclone config file', () => {
    expect(parseRcloneConfigPath('Configuration file is stored at:\n/Users/demo/.config/rclone/rclone.conf\n'))
      .toBe('/Users/demo/.config/rclone/rclone.conf');
  });
});
