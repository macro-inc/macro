import type { Attachment } from '@core/component/AI/types';
import { describe, expect, it, vi } from 'vitest';
import {
  replaceHomeComposerDraft,
  replaceHomeComposerSelection,
} from './home-composer-selection';

describe('replaceHomeComposerDraft', () => {
  it('sets the selected draft as the complete editor value', () => {
    const setMarkdown = vi.fn();

    replaceHomeComposerDraft({ setMarkdown }, 'Selected prompt');

    expect(setMarkdown).toHaveBeenCalledOnce();
    expect(setMarkdown).toHaveBeenCalledWith('Selected prompt');
  });
});

describe('replaceHomeComposerSelection', () => {
  it('replaces attachments before setting the selected draft', () => {
    const setAttached = vi.fn();
    const setPendingDraft = vi.fn();
    const attachment: Attachment = {
      entity_id: 'document-1',
      entity_type: 'document',
    };

    replaceHomeComposerSelection(
      { attachments: { setAttached }, setPendingDraft },
      'Review this document',
      [attachment]
    );

    expect(setAttached).toHaveBeenCalledWith([attachment]);
    expect(setAttached.mock.invocationCallOrder[0]).toBeLessThan(
      setPendingDraft.mock.invocationCallOrder[0]
    );
    expect(setPendingDraft).toHaveBeenCalledWith('Review this document');
  });

  it('clears attachments for a selection without context', () => {
    const setAttached = vi.fn();
    const setPendingDraft = vi.fn();

    replaceHomeComposerSelection(
      { attachments: { setAttached }, setPendingDraft },
      'Draft an email'
    );

    expect(setAttached).toHaveBeenCalledWith([]);
    expect(setPendingDraft).toHaveBeenCalledWith('Draft an email');
  });
});
