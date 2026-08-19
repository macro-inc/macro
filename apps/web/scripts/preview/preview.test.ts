import { describe, expect, it } from 'vitest';
import { previewSyncArguments, publishPreviewAssets } from './deploy';
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
    const body =
      '**Preview:** [https://my-feature-abc123.preview.macro.com](...)';
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
    const longBranch =
      'this-is-a-very-long-branch-name-that-exceeds-thirty-chars';
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

describe('preview cache WASM deployment', () => {
  it('excludes only cache WASM raw/sidecar from generic sync', () => {
    const argumentsList = previewSyncArguments('preview-id', '/tmp/dist');
    expect(argumentsList).toContain('*cache_wasm_bg*.wasm');
    expect(argumentsList).toContain('*cache_wasm_bg*.wasm.br');
    expect(argumentsList).not.toContain('*.wasm');
    expect(argumentsList).not.toContain('*.wasm.br');
  });

  it('publishes current WASM, assets, and index before pruning', () => {
    const calls: string[][] = [];
    publishPreviewAssets('preview-id', '/tmp/dist', (executable, args) => {
      calls.push([executable, ...args]);
    });
    expect(calls.map((call) => call[0])).toEqual([
      'bash',
      'aws',
      'aws',
      'bash',
    ]);
    expect(calls[0].join(' ')).toContain('upload-brotli-to-s3.sh');
    expect(calls[1].slice(0, 3)).toEqual(['aws', 's3', 'sync']);
    expect(calls[2].slice(0, 3)).toEqual(['aws', 's3', 'cp']);
    expect(calls[3].join(' ')).toContain('prune-old-brotli-from-s3.sh');
  });

  it.each([1, 2])(
    'does not prune when publication step %i fails',
    (failedCall) => {
      const calls: string[][] = [];
      expect(() =>
        publishPreviewAssets('preview-id', '/tmp/dist', (executable, args) => {
          calls.push([executable, ...args]);
          if (calls.length - 1 === failedCall) throw new Error('publish failed');
        })
      ).toThrow('publish failed');
      expect(
        calls.some((call) =>
          call.join(' ').includes('prune-old-brotli-from-s3.sh')
        )
      ).toBe(false);
    }
  );
});

describe('roundtrip: build url then extract id', () => {
  it('extracts same id from generated comment', () => {
    const originalId = 'my-feature-abc123';
    const body = buildCommentBody(originalId, 'deadbeef');
    const extractedId = extractPreviewIdFromBody(body);
    expect(extractedId).toBe(originalId);
  });
});
