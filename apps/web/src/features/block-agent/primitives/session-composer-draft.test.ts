/**
 * @vitest-environment jsdom
 */

import type { InputAttachmentData } from '@channel/Input/types';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  agentSessionAttachmentsKey,
  agentSessionDraftKey,
  createSessionAttachmentTracker,
  createSessionComposerDraft,
} from './session-composer-draft';

const note: InputAttachmentData = {
  id: 'file-1',
  name: 'notes.txt',
  kind: 'document',
};

function withRoot(run: () => void) {
  let dispose: () => void = () => {};
  createRoot((done) => {
    dispose = done;
    run();
  });
  dispose();
}

describe('session composer drafts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores one session without touching another', () => {
    withRoot(() => {
      const first = createSessionComposerDraft(() => 'session-a');
      const second = createSessionComposerDraft(() => 'session-b');
      first.setDraft('Ask about the plan');
      second.setDraft('Ask about the code');
    });

    withRoot(() => {
      const first = createSessionComposerDraft(() => 'session-a');
      const second = createSessionComposerDraft(() => 'session-b');
      expect(first.draft()).toBe('Ask about the plan');
      expect(second.draft()).toBe('Ask about the code');
      first.setDraft('');
      expect(second.draft()).toBe('Ask about the code');
    });

    expect(localStorage.getItem(agentSessionDraftKey('session-a'))).toBeNull();
    withRoot(() => {
      expect(createSessionComposerDraft(() => 'session-a').draft()).toBe('');
      expect(createSessionComposerDraft(() => 'session-b').draft()).toBe(
        'Ask about the code'
      );
    });
  });

  it('puts a refused message into the saved draft once its composer is gone', () => {
    let sent: ReturnType<typeof createSessionComposerDraft> | undefined;
    let sentFiles:
      | ReturnType<typeof createSessionAttachmentTracker>
      | undefined;
    withRoot(() => {
      sent = createSessionComposerDraft(() => 'session-a');
      sentFiles = createSessionAttachmentTracker(() => 'session-a');
    });
    // The session reopened and the user typed before the refusal came back.
    withRoot(() => {
      const reopened = createSessionComposerDraft(() => 'session-a');
      reopened.setDraft('Typed after reopening');
    });

    sent?.restore('session-a', 'Run the tests');
    sentFiles?.restore('session-a', [note]);

    expect(localStorage.getItem(agentSessionDraftKey('session-a'))).toBe(
      JSON.stringify('Run the tests\n\nTyped after reopening')
    );
    expect(localStorage.getItem(agentSessionAttachmentsKey('session-a'))).toBe(
      JSON.stringify([note])
    );
  });

  it('puts a refused message back in the session it was sent to', () => {
    const [sessionId, setSessionId] = createSignal<string | undefined>(
      'session-a'
    );
    let draft: ReturnType<typeof createSessionComposerDraft> | undefined;
    let dispose: () => void = () => {};
    createRoot((done) => {
      dispose = done;
      draft = createSessionComposerDraft(sessionId);
    });
    // The composer moved on to another session while the send was out.
    setSessionId('session-b');
    draft?.setDraft('Question for b');

    draft?.restore('session-a', 'Run the tests');

    expect(draft?.draft()).toBe('Question for b');
    expect(localStorage.getItem(agentSessionDraftKey('session-a'))).toBe(
      JSON.stringify('Run the tests')
    );
    dispose();
  });

  it('keeps text typed before the session id exists', () => {
    const [sessionId, setSessionId] = createSignal<string | undefined>();
    let draft: ReturnType<typeof createSessionComposerDraft> | undefined;
    let dispose: () => void = () => {};
    createRoot((done) => {
      dispose = done;
      draft = createSessionComposerDraft(sessionId, () => 'Seed');
    });
    expect(draft?.draft()).toBe('Seed');
    draft?.setDraft('Follow up while it starts');
    setSessionId('session-real');
    expect(draft?.draft()).toBe('Follow up while it starts');
    dispose();

    expect(localStorage.getItem(agentSessionDraftKey('session-real'))).toBe(
      JSON.stringify('Follow up while it starts')
    );
    withRoot(() => {
      expect(createSessionComposerDraft(() => 'session-real').draft()).toBe(
        'Follow up while it starts'
      );
    });
  });

  it('removes a cleared editor draft when its markdown contains only whitespace', () => {
    withRoot(() => {
      const draft = createSessionComposerDraft(() => 'session-a');
      const other = createSessionComposerDraft(() => 'session-b');
      draft.setDraft('Follow up');
      other.setDraft('  Keep the indentation\n');
      draft.setDraft('\n \n');
    });

    expect(localStorage.getItem(agentSessionDraftKey('session-a'))).toBeNull();
    withRoot(() => {
      expect(createSessionComposerDraft(() => 'session-a').draft()).toBe('');
      expect(createSessionComposerDraft(() => 'session-b').draft()).toBe(
        '  Keep the indentation\n'
      );
    });
  });

  it('ignores a previously saved whitespace-only draft when seeding context', () => {
    localStorage.setItem(
      agentSessionDraftKey('session-a'),
      JSON.stringify('\n \n')
    );
    withRoot(() => {
      const draft = createSessionComposerDraft(
        () => 'session-a',
        () => 'Document context'
      );
      expect(draft.draft()).toBe('Document context');
    });
  });

  it('keeps seeded context for an existing session after a remount', () => {
    withRoot(() => {
      createSessionComposerDraft(
        () => 'session-a',
        () => 'Document context'
      );
    });
    withRoot(() => {
      const draft = createSessionComposerDraft(() => 'session-a');
      expect(draft.draft()).toBe('Document context');
    });
  });

  it('prefers a saved draft over seeded context', () => {
    withRoot(() => {
      createSessionComposerDraft(() => 'session-a').setDraft('Already typed');
    });
    withRoot(() => {
      const draft = createSessionComposerDraft(
        () => 'session-a',
        () => 'Document context'
      );
      expect(draft.draft()).toBe('Already typed');
    });
  });

  it('restores settled attachments and drops uploads that never finished', () => {
    withRoot(() => {
      const tracker = createSessionAttachmentTracker(() => 'session-a');
      tracker.addAttachment(note);
      tracker.addAttachment({ ...note, id: 'pending-file', pending: true });
    });

    expect(
      localStorage.getItem(agentSessionAttachmentsKey('session-a'))
    ).toContain('notes.txt');
    expect(
      localStorage.getItem(agentSessionAttachmentsKey('session-a'))
    ).not.toContain('pending-file');

    withRoot(() => {
      const tracker = createSessionAttachmentTracker(() => 'session-a');
      expect(tracker.attachments().map((file) => file.id)).toEqual(['file-1']);
      tracker.clearAttachments();
    });

    expect(
      localStorage.getItem(agentSessionAttachmentsKey('session-a'))
    ).toBeNull();
    withRoot(() => {
      expect(
        createSessionAttachmentTracker(() => 'session-a').attachments()
      ).toEqual([]);
    });
  });

  it('moves attachments onto the session id once it exists', () => {
    const [sessionId, setSessionId] = createSignal<string | undefined>();
    let tracker: ReturnType<typeof createSessionAttachmentTracker> | undefined;
    let dispose: () => void = () => {};
    createRoot((done) => {
      dispose = done;
      tracker = createSessionAttachmentTracker(sessionId);
    });
    tracker?.addAttachment(note);
    setSessionId('session-real');
    expect(tracker?.attachments().map((file) => file.id)).toEqual(['file-1']);
    dispose();

    withRoot(() => {
      expect(
        createSessionAttachmentTracker(() => 'session-real')
          .attachments()
          .map((file) => file.id)
      ).toEqual(['file-1']);
    });
  });
});
