import { describe, expect, it } from 'vitest';
import {
  isPreviewControllerContent,
  previewControllerWidthForContent,
} from '../previewController';
import {
  DEFAULT_SPLIT_MIN_WIDTH,
  splitMinWidthForContent,
} from '../splitContentSizing';

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
    const defaultWidth = previewControllerWidthForContent({
      type: 'component',
      id: 'inbox',
    });
    const channelsWidth = previewControllerWidthForContent({
      type: 'component',
      id: 'channels',
    });
    const mailWidth = previewControllerWidthForContent({
      type: 'component',
      id: 'mail',
    });
    const companiesWidth = previewControllerWidthForContent({
      type: 'component',
      id: 'companies',
    });

    expect(defaultWidth).toBeDefined();
    expect(channelsWidth).not.toBe(defaultWidth);
    expect(mailWidth).not.toBe(defaultWidth);
    expect(companiesWidth).not.toBe(defaultWidth);

    const companiesWidthInNarrowViewport = previewControllerWidthForContent(
      { type: 'component', id: 'companies' },
      100
    );
    const companiesWidthInWideViewport = previewControllerWidthForContent(
      { type: 'component', id: 'companies' },
      10_000
    );
    expect(companiesWidthInNarrowViewport).toBeLessThan(
      companiesWidthInWideViewport!
    );
    expect(
      previewControllerWidthForContent({ type: 'component', id: 'settings' })
    ).toBeUndefined();
    expect(
      previewControllerWidthForContent({
        type: 'project',
        id: 'project-1',
      })
    ).toBe(defaultWidth);
  });

  it('uses the configured list-view minimum only for Preview Controllers', () => {
    const previewController = { isPreviewController: true };
    const standaloneSplit = { isPreviewController: false };
    const listViewContent = { type: 'component' as const, id: 'inbox' };

    expect(
      splitMinWidthForContent(listViewContent, previewController)
    ).not.toBe(DEFAULT_SPLIT_MIN_WIDTH);
    expect(splitMinWidthForContent(listViewContent, standaloneSplit)).toBe(
      DEFAULT_SPLIT_MIN_WIDTH
    );
    expect(
      splitMinWidthForContent(
        { type: 'component', id: 'settings' },
        previewController
      )
    ).toBe(DEFAULT_SPLIT_MIN_WIDTH);
    expect(
      splitMinWidthForContent({ type: 'md', id: 'doc-1' }, previewController)
    ).toBe(DEFAULT_SPLIT_MIN_WIDTH);
  });
});
