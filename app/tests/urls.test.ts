import { describe, it, expect } from 'vitest';
import { VIEWER_ROUTE, createUrls } from '../src/urls';

describe('createUrls.viewerUrl', () => {
  it('builds the absolute Viewer URL for a slug', () => {
    const urls = createUrls({ publicAppUrl: 'https://record.example.com' });
    expect(urls.viewerUrl('abc123')).toBe('https://record.example.com/v/abc123');
  });

  it('strips a trailing slash from publicAppUrl', () => {
    const urls = createUrls({ publicAppUrl: 'https://record.example.com/' });
    expect(urls.viewerUrl('abc123')).toBe('https://record.example.com/v/abc123');
  });
});

describe('VIEWER_ROUTE / viewerUrl coupling', () => {
  // The whole reason urls.ts exists: pin the contract between the route
  // template `app.ts` mounts and the path shape `viewerUrl` produces. If
  // someone changes one without the other, this test breaks.
  it('viewerUrl path is matched by VIEWER_ROUTE with the slug recoverable', () => {
    const urls = createUrls({ publicAppUrl: 'https://record.example.com' });
    const url = new URL(urls.viewerUrl('abc123'));
    const pattern = VIEWER_ROUTE.replace(/:[a-zA-Z]+/g, '([^/]+)');
    const m = url.pathname.match(new RegExp(`^${pattern}$`));
    expect(m).not.toBeNull();
    expect(m![1]).toBe('abc123');
  });
});
