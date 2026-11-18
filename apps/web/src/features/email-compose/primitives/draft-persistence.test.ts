import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createComposeContext } from '../tests/capabilities';
import { createDraftPersistence } from './draft-persistence';
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
