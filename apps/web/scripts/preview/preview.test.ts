import { describe, expect, it } from 'vitest';
import {
  extractPreviewIdFromBody,
  generatePreviewId,
  PREVIEW_URL_REGEX,
} from './get-or-create-id';
import { buildCommentBody, buildPreviewUrl } from './post-comment';

describe('buildPreviewUrl', () => {
  it('appends /app to preview domain', () => {
    expect(buildPreviewUrl('my-feature-abc123')).toBe(
      'https://my-feature-abc123.preview.macro.com/app'
    );
  });

  it('handles simple preview ids', () => {
    expect(buildPreviewUrl('test')).toBe('https://test.preview.macro.com/app');
  });
});

describe('buildCommentBody', () => {
  it('creates markdown link with /app suffix', () => {
    const body = buildCommentBody('my-feature-abc123', 'abcdef1234567890');
    expect(body).toBe(
      '**Preview:** [https://my-feature-abc123.preview.macro.com/app](https://my-feature-abc123.preview.macro.com/app) (abcdef1)'
    );
  });

  it('truncates sha to 7 characters', () => {
    const body = buildCommentBody('test', '1234567890abcdef');
    expect(body).toContain('(1234567)');
  });
});

describe('extractPreviewIdFromBody', () => {
  it('extracts preview id from url without path', () => {
    const body = '**Preview:** [https://my-feature-abc123.preview.macro.com](...)';
    expect(extractPreviewIdFromBody(body)).toBe('my-feature-abc123');
  });

  it('extracts preview id from url with /app path', () => {
    const body =
      '**Preview:** [https://my-feature-abc123.preview.macro.com/app](https://my-feature-abc123.preview.macro.com/app) (abcdef1)';
    expect(extractPreviewIdFromBody(body)).toBe('my-feature-abc123');
  });

  it('returns null for non-matching body', () => {
    expect(extractPreviewIdFromBody('no preview here')).toBe(null);
  });

  it('handles complex preview ids with numbers and hyphens', () => {
    const body = 'https://feat-123-some-thing-xyz789.preview.macro.com/app';
    expect(extractPreviewIdFromBody(body)).toBe('feat-123-some-thing-xyz789');
  });
});

describe('PREVIEW_URL_REGEX', () => {
  it('matches urls with /app suffix', () => {
    const url = 'https://test-abc123.preview.macro.com/app';
    expect(url.match(PREVIEW_URL_REGEX)?.[1]).toBe('test-abc123');
  });

  it('matches urls without path', () => {
    const url = 'https://test-abc123.preview.macro.com';
    expect(url.match(PREVIEW_URL_REGEX)?.[1]).toBe('test-abc123');
  });
});

describe('generatePreviewId', () => {
  it('sanitizes branch names', () => {
    const id = generatePreviewId('Feature/MY-Branch_Name');
    expect(id).toMatch(/^feature-my-branch-name-[a-z0-9]{6}$/);
  });

  it('truncates long branch names to 30 chars', () => {
    const longBranch = 'this-is-a-very-long-branch-name-that-exceeds-thirty-chars';
    const id = generatePreviewId(longBranch);
    const prefixWithoutNanoid = id.slice(0, -7);
    expect(prefixWithoutNanoid.length).toBeLessThanOrEqual(30);
  });

  it('falls back to git branch when override is empty', () => {
    const id = generatePreviewId('');
    expect(id).toMatch(/^[a-z0-9-]+-[a-z0-9]{6}$/);
  });

  it('removes leading and trailing hyphens', () => {
    const id = generatePreviewId('--branch--');
    expect(id).not.toMatch(/^-/);
    expect(id.slice(0, -7)).not.toMatch(/-$/);
  });
});

describe('roundtrip: build url then extract id', () => {
  it('extracts same id from generated comment', () => {
    const originalId = 'my-feature-abc123';
    const body = buildCommentBody(originalId, 'deadbeef');
    const extractedId = extractPreviewIdFromBody(body);
    expect(extractedId).toBe(originalId);
  });
});
