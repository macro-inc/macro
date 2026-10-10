import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { EmailThread } from '../core/email-thread';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { createEmailThreadState } from './email-thread-state';

describe('thread state with an injected source', () => {
  it('adopts a canonical reply identity over a restored local handle despite client clock skew', () =>
    createRoot((dispose) => {
      try {
        const local = message('local-draft', {
          is_draft: true,
          replying_to_id: 'parent',
          updated_at: '2026-09-01T12:00:00Z',
        });
        const [snapshot, setSnapshot] = createSignal(
          thread([message('parent'), local])
        );
        const state = createEmailThreadState(
          createThreadContext({ thread: snapshot })
        );
        state.drafts.deleteDraftForMessage('parent');
        const restored = {
          ...local,
          body_text: 'Restored reply',
          updated_at: '2026-09-01T13:00:00Z',
        };
        state.drafts.restoreDraftForMessage(restored);
        expect(state.drafts.getDraftForMessage('parent')).toEqual(restored);
        const canonical = {
          ...restored,
          db_id: 'server-draft',
          updated_at: '2026-09-01T10:00:00Z',
        };
        setSnapshot(thread([message('parent'), canonical]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(canonical);
        const edited = {
          ...canonical,
          body_text: 'New canonical edits',
          updated_at: '2026-09-01T11:00:00Z',
        };
        setSnapshot(thread([message('parent'), edited]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(edited);
        state.drafts.deleteDraftForMessage('parent');
        expect(state.drafts.getDraftForMessage('parent')).toBeUndefined();
      } finally {
        dispose();
      }
    }));

  it('does not move an open bottom reply to a newly sent message', () =>
    createRoot((dispose) => {
      try {
        const parent = message('parent');
        const [snapshot, setSnapshot] = createSignal(thread([parent]));
        const state = createEmailThreadState(
          createThreadContext({ thread: snapshot })
        );
        state.messages.setBottomReplyOpen(true);
        expect(state.messages.bottomReplyOpen()).toBe(true);
        setSnapshot(thread([{ ...parent, body_text: 'Refreshed' }]));
        expect(state.messages.bottomReplyOpen()).toBe(true);
        setSnapshot(thread([parent, message('sent')]));
        expect(state.messages.bottomReplyOpen()).toBe(false);
        // Replying to the new message still requires a deliberate action.
        state.messages.setBottomReplyOpen(true);
        expect(state.messages.bottomReplyOpen()).toBe(true);
        setSnapshot(thread([message('sent')], { db_id: 'another-thread' }));
        expect(state.messages.bottomReplyOpen()).toBe(false);
      } finally {
        dispose();
      }
    }));

  it('keeps a newly restored canonical reply ahead of the unchanged local source handle', () =>
    createRoot((dispose) => {
      try {
        const local = message('local-draft', {
          is_draft: true,
          replying_to_id: 'parent',
          updated_at: '2026-09-01T12:00:00Z',
        });
        const [snapshot, setSnapshot] = createSignal(
          thread([message('parent'), local])
        );
        const state = createEmailThreadState(
          createThreadContext({ thread: snapshot })
        );
        const restored = {
          ...local,
          db_id: 'server-draft',
          body_text: 'Restored canonical reply',
          updated_at: '2026-09-01T10:00:00Z',
        };
        state.drafts.restoreDraftForMessage(restored);
        expect(state.drafts.getDraftForMessage('parent')).toEqual(restored);
        setSnapshot(thread([message('parent'), { ...local }]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(restored);
        const canonical = {
          ...restored,
          body_text: 'Canonical source caught up',
          updated_at: '2026-09-01T11:00:00Z',
        };
        setSnapshot(thread([message('parent'), canonical]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(canonical);
      } finally {
        dispose();
      }
    }));

  it('explicit restoration reopens a sent reply tombstone without resurrecting stale content', () =>
    createRoot((dispose) => {
      try {
        const sent = message('draft', {
          is_draft: true,
          replying_to_id: 'parent',
          updated_at: '2026-09-01T10:00:00Z',
        });
        const [snapshot, setSnapshot] = createSignal(
          thread([message('parent'), sent])
        );
        const state = createEmailThreadState(
          createThreadContext({ thread: snapshot })
        );
        state.drafts.deleteDraftForMessage('parent');
        const restored = {
          ...sent,
          body_text: 'Original restored body',
          updated_at: '2026-09-01T11:00:00Z',
        };
        state.drafts.restoreDraftForMessage(restored);
        expect(state.drafts.getDraftForMessage('parent')).toEqual(restored);
        setSnapshot(thread([message('parent'), sent]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(restored);
        const edited = {
          ...restored,
          body_text: 'New edits',
          updated_at: '2026-09-01T12:00:00Z',
        };
        setSnapshot(thread([message('parent'), edited]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(edited);
        state.drafts.deleteDraftForMessage('parent');
        expect(state.drafts.getDraftForMessage('parent')).toBeUndefined();
      } finally {
        dispose();
      }
    }));
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
        const committed = { ...old, db_id: 'server-id' };
        setSnapshot(thread([message('parent'), committed]));
        expect(state.drafts.getDraftForMessage('parent')).toEqual(committed);
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
