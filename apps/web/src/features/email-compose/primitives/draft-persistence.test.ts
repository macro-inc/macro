import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { EmailDraftLifecycleState } from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import {
  createAlreadySentSettlement,
  createDraftPersistence,
} from './draft-persistence';
import { createDraftSession } from './draft-session';

it('deletes an emptied draft', async () => {
  const deleteDraft = vi.fn(async () => {});
  const { dispose, session, persistence } = createRoot((dispose) => {
    const session = createDraftSession({
      draftId: 'draft',
      threadId: 'thread',
      persistence: 'committed',
    });
    const persistence = createDraftPersistence({
      session,
      drafts: { ...createComposeContext().drafts, deleteDraft },
      attachments: { upload: vi.fn(async () => {}) },
      mintThreadHandle: true,
      onAlreadySent: vi.fn(),
    });
    return { dispose, session, persistence };
  });
  try {
    await persistence.remove({});

    expect(deleteDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'draft', threadId: 'thread' })
    );
    expect(session.draftId()).toBeUndefined();
  } finally {
    dispose();
  }
});

it('leaves a draft refused as sent to a discard that starts while it is read', async () => {
  const session = createDraftSession({
    draftId: 'draft',
    threadId: 'thread',
    persistence: 'committed',
  });
  session.dispatch({
    type: 'rejected',
    epoch: session.epoch(),
    code: 'DRAFT_ALREADY_SENT',
  });
  const read = Promise.withResolvers<EmailDraftLifecycleState>();
  let discarding = false;
  const notices = createComposeContext().notices;
  const settle = vi.fn(() => true);
  const settlement = createAlreadySentSettlement({
    session,
    read: () => read.promise,
    notices,
    superseded: () => discarding,
    settle,
  });

  const settled = settlement();
  discarding = true;
  read.resolve({
    type: 'sent',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    observedAt: 0,
  });
  await settled;

  expect(settle).not.toHaveBeenCalled();
  expect(notices.feedback.alert).not.toHaveBeenCalled();
  expect(session.alreadySent()).toBe(true);
});
