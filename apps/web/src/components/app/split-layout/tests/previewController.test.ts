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
    expect(
      isPreviewControllerContent({ type: 'project', id: 'project-1' })
    ).toBe(true);
  });

  it('resolves default and content-specific widths from the same config', () => {
    expect(
      previewControllerWidthForContent({ type: 'component', id: 'inbox' })
    ).toBe(440);
    expect(
      previewControllerWidthForContent({ type: 'component', id: 'mail' })
    ).toBe(1050);
    expect(
      previewControllerWidthForContent({ type: 'component', id: 'companies' })
    ).toBe(880);
    expect(
      previewControllerWidthForContent(
        { type: 'component', id: 'companies' },
        1000
      )
    ).toBe(700);
    expect(
      previewControllerWidthForContent(
        { type: 'component', id: 'companies' },
        1600
      )
    ).toBe(880);
    expect(
      previewControllerWidthForContent({ type: 'component', id: 'settings' })
    ).toBeUndefined();
    expect(
      previewControllerWidthForContent({
        type: 'project',
        id: 'project-1',
      })
    ).toBe(440);
  });
});
