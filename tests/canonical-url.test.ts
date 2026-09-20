import { describe, expect, it } from 'vitest';
import { canonicalUrl } from '../src/canonical-url.js';

describe('canonicalUrl', () => {
  it('normalizes two spellings of the same page to one canonical form', () => {
    expect(canonicalUrl('HTTPS://Example.COM')).toBe('https://example.com/');
    expect(canonicalUrl('  https://example.com  ')).toBe('https://example.com/');
    expect(canonicalUrl('https://example.com:443/')).toBe('https://example.com/');
    expect(canonicalUrl('http://example.com:80/news')).toBe('http://example.com/news');
  });

  it('keeps query, fragment and www exactly as written (no over-normalization)', () => {
    expect(canonicalUrl('https://www.example.com/?b=2&a=1')).toBe(
      'https://www.example.com/?b=2&a=1',
    );
    expect(canonicalUrl('https://example.com/docs#section')).toBe(
      'https://example.com/docs#section',
    );
  });

  it('returns null for non-web URLs and garbage', () => {
    expect(canonicalUrl('place:folder=BOOKMARK_MENU')).toBeNull();
    expect(canonicalUrl('ftp://example.com/file')).toBeNull();
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
    expect(canonicalUrl('')).toBeNull();
  });
});
