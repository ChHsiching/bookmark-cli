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
    // Existing percent-escapes are not re-cased or decoded.
    expect(canonicalUrl('https://example.com/?b=2&a=%2f')).toBe('https://example.com/?b=2&a=%2f');
  });

  it('pins the syntax-level serialization the canonical form inherits (ADR-0003)', () => {
    // Dot-segment folding, percent-encoding of spaces, IDN → punycode: all
    // RFC 3986 §6.2.2-class equivalences that come with URL serialization.
    expect(canonicalUrl('https://example.com/a/../b')).toBe('https://example.com/b');
    expect(canonicalUrl('https://x.com/a/./b/')).toBe('https://x.com/a/b/');
    expect(canonicalUrl('https://example.com/?q=a b')).toBe('https://example.com/?q=a%20b');
    expect(canonicalUrl('https://example.com/docs#sec tion')).toBe(
      'https://example.com/docs#sec%20tion',
    );
    expect(canonicalUrl('https://BÜCHER.example.com/')).toBe('https://xn--bcher-kva.example.com/');
  });

  it('returns null for non-web URLs and garbage', () => {
    expect(canonicalUrl('place:folder=BOOKMARK_MENU')).toBeNull();
    expect(canonicalUrl('ftp://example.com/file')).toBeNull();
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
    expect(canonicalUrl('')).toBeNull();
  });
});
