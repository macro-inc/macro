import { describe, expect, it } from 'vitest';
import {
  isPreviewControllerContent,
  previewControllerWidthForContent,
} from '../previewController';

describe('preview controller content', () => {
  it('explicitly recognizes configured content', () => {
    expect(isPreviewControllerContent({ type: 'component', id: 'inbox' })).toBe(
      true
    );
    expect(
      isPreviewControllerContent({ type: 'component', id: 'settings' })
    ).toBe(false);
    expect(isPreviewControllerContent({ type: 'md', id: 'doc-1' })).toBe(false);
  });

  it('resolves default and content-specific widths from the same config', () => {
    expect(
      previewControllerWidthForContent({ type: 'component', id: 'inbox' })
    ).toBe(440);
    expect(
      previewControllerWidthForContent({ type: 'component', id: 'mail' })
    ).toBe(880);
    expect(
      previewControllerWidthForContent({ type: 'component', id: 'settings' })
    ).toBeUndefined();
  });
});
