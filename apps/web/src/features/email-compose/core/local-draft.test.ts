import { expect, it } from 'vitest';
import { type LocalDraft, localDraftReadyForDelivery } from './local-draft';

const draft: LocalDraft = {
  key: 'draft',
  accountId: 'owner',
  generation: 'generation',
  draftId: 'draft',
  serverDraftId: 'server',
  revision: 2,
  acknowledgedRevision: 2,
  content: { subject: 'Ready' },
  attachments: [],
  status: 'synced',
  updatedAt: 1,
};
it('blocks both delivery paths when server identity is confirmed but newer edits or files are pending', () => {
  expect(localDraftReadyForDelivery(draft)).toBe(true);
  expect(localDraftReadyForDelivery({ ...draft, revision: 3 })).toBe(false);
  expect(localDraftReadyForDelivery({ ...draft, status: 'unconfirmed' })).toBe(
    false
  );
  expect(
    localDraftReadyForDelivery({
      ...draft,
      attachments: [
        {
          type: 'local',
          id: 'file',
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: 1,
          lastModified: 0,
          uploaded: false,
        },
      ],
    })
  ).toBe(false);
});
