import { describe, expect, it } from 'vitest';
import { resolveUploadContentType } from './uploadContentType';

describe('resolveUploadContentType', () => {
  it('keeps a specific explicit mime type', () => {
    expect(
      resolveUploadContentType({
        name: 'clip.mov',
        mimeType: 'video/quicktime',
      })
    ).toBe('video/quicktime');
  });

  it('infers a video mime type from the filename when none is provided', () => {
    expect(
      resolveUploadContentType({
        name: 'clip.mov',
        mimeType: '',
      })
    ).toBe('video/quicktime');
  });

  it('replaces generic octet-stream with a known extension mime type', () => {
    expect(
      resolveUploadContentType({
        name: 'clip.mp4',
        mimeType: 'application/octet-stream',
      })
    ).toBe('video/mp4');
  });
});
