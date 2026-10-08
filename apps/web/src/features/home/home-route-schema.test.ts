import { describe, expect, it } from 'vitest';
import { homePreviewRouteParams } from './home-route-schema';

describe('home preview route params', () => {
  it('opens a DOCX item in the write block', () => {
    expect(
      homePreviewRouteParams.safeParse({ blockType: 'write', previewId: 'doc' })
        .success
    ).toBe(true);
  });

  it('leaves calendar to the calendar route', () => {
    expect(
      homePreviewRouteParams.safeParse({
        blockType: 'calendar',
        previewId: 'id',
      }).success
    ).toBe(false);
  });
});
