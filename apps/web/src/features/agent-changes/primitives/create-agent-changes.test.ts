/**
 * Sending queued notes: one prompt, and a second take in the same tick is
 * empty so a composer send cannot post the same notes again.
 */

import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { formatNotesForAgent } from '../core/review-notes';
import { createMemoryStorage } from '../tests/memory-storage';
import {
  createMockAgentChangesContext,
  mockChangeset,
} from '../tests/mock-context';
import { createAgentChanges, type DiffStyle } from './create-agent-changes';

function setup() {
  const context = createMockAgentChangesContext({
    summary: { capturing: false, changeset: mockChangeset() },
  });
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('unified');
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createAgentChanges({
    context,
    storage: createMemoryStorage(),
    diffStyle: [diffStyle, setDiffStyle],
    dismissed: [dismissed, setDismissed],
  });
  return { context, controller };
}

const ANCHOR = {
  path: 'apps/web/src/a.ts',
  side: 'additions' as const,
  lineNumber: 2,
  endLineNumber: 2,
};

describe('createAgentChanges notes send', () => {
  it('posts queued notes once, then a second send or consume is empty', () => {
    createRoot((dispose) => {
      const { context, controller } = setup();
      controller.review.addNote(ANCHOR, 'Use a constant');

      controller.sendQueuedNotes();
      controller.sendQueuedNotes();

      expect(context.sent).toEqual([
        formatNotesForAgent([
          {
            id: 'ignored',
            ...ANCHOR,
            text: 'Use a constant',
            createdAt: 'ignored',
          },
        ]),
      ]);
      expect(controller.consumeSendableNotes()).toBe('');
      expect(controller.review.queued()).toEqual([]);
      dispose();
    });
  });

  it('lets the composer take notes so a later chip send does not post them again', () => {
    createRoot((dispose) => {
      const { context, controller } = setup();
      controller.review.addNote(ANCHOR, 'Use a constant');

      const taken = controller.consumeSendableNotes();
      expect(taken).toContain('Use a constant');
      expect(taken).toContain('`apps/web/src/a.ts`, line 2 (new)');

      controller.sendQueuedNotes();
      expect(context.sent).toEqual([]);
      expect(controller.review.queued()).toEqual([]);
      dispose();
    });
  });
});
