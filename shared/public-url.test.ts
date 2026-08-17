import { describe, expect, it } from 'vitest';
import { normalizePublicBaseUrl } from './public-url';

describe('public URL validation', () => {
  it('rejects API-like invalid URL input instead of emitting a broken link', () => {
    expect(() => normalizePublicBaseUrl('cdn.example.com')).toThrow('URL public');
    expect(() => normalizePublicBaseUrl('ftp://cdn.example.com')).toThrow('https://');
  });

  it('normalizes a valid HTTPS URL for external navigation', () => {
    expect(normalizePublicBaseUrl('https://onzload.com/embed/asset/')).toBe('https://onzload.com/embed/asset');
  });
});
