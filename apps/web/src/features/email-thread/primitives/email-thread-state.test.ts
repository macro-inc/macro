import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { EmailThread } from '../core/email-thread';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { createEmailThreadState } from './email-thread-state';

describe('thread state with an injected source', () => {
  it('retains newer drafts through stale snapshots and does not resurrect discarded replies', () =>
    createRoot((dispose) => {
      try {
        const old = message('draft', {
          is_draft: true,
          replying_to_id: 'parent',
          updated_at: '2026-09-01T10:00:00Z',
        });
        const newer = {
          ...old,
          updated_at: '2026-09-01T11:00:00Z',
          body_html_sanitized: '<p>Newer reply</p>',
        };
        const [snapshot, setSnapshot] = createSignal<EmailThread | undefined>(
          thread([message('parent'), old])
        );
        const state = createEmailThreadState(
          createThreadContext({
            thread: snapshot,
          })
        );
        expect(state.drafts.initialDraftsSettled()).toBe(true);
        setSnapshot(thread([message('parent'), newer]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(newer);
        setSnapshot(thread([message('parent'), old]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(newer);
        setSnapshot(thread([message('parent')]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(newer);
        state.drafts.deleteDraftForMessage('parent');
        setSnapshot(thread([message('parent'), newer]));
        expect(state.drafts.getDraftForMessage('parent')).toBeUndefined();
        setSnapshot(thread([message('another')], { db_id: 'another-thread' }));
        expect(state.messages.list().map((message) => message.db_id)).toEqual([
          'another',
        ]);
        expect(state.drafts.getDraftForMessage('parent')).toBeUndefined();
      } finally {
        dispose();
      }
    }));

  it('keeps selection and programmatic scrolling local to each mounted thread', () =>
    createRoot((dispose) => {
      try {
        const source = {
          thread: () => thread([message('one')]),
        };
        const first = createEmailThreadState(createThreadContext(source));
        const second = createEmailThreadState(createThreadContext(source));
        first.messages.setFocused('one');
        first.setIsScrollingToMessage(true);
        expect(first.messages.focusedId()).toBe('one');
        expect(first.isScrollingToMessage()).toBe(true);
        expect(second.messages.focusedId()).toBeUndefined();
        expect(second.isScrollingToMessage()).toBe(false);
      } finally {
        dispose();
      }
    }));
});
