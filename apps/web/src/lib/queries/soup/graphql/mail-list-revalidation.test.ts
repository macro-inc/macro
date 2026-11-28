import type { SoupUpdatesSubscription } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { registerActiveGraphqlSoupQuery } from './active-queries';
import { revalidateMailAttachmentListsForSoupUpdates } from './mail-list-revalidation';

type SoupPatch = SoupUpdatesSubscription['soupUpdates'][number];

function thread(attachments: unknown[]): SoupPatch {
  return {
    __typename: 'SoupUpdated',
    item: {
      __typename: 'GraphqlSoupEmailThread',
      id: crypto.randomUUID(),
      attachments,
    },
  } as unknown as SoupPatch;
}

function registerList(
  ef: unknown,
  options: { cacheMaintained?: () => boolean } = {}
) {
  const refresh = vi.fn(async () => {});
  onTestFinished(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh,
      body: () => ({ ef }),
      ...options,
    })
  );
  return refresh;
}

const PDFS = {
  '&': [{ l: { Importance: true } }, { l: { Attachment: 'pdf' } }],
};

describe('revalidateMailAttachmentListsForSoupUpdates', () => {
  it('refreshes lists filtered by attachment kind when a thread with attachments arrives', async () => {
    const pdfs = registerList(PDFS);
    const either = registerList({
      '|': [{ l: { Attachment: 'pdf' } }, { l: { Attachment: 'document' } }],
    });
    const unfiltered = registerList({ l: { Importance: true } });
    const negated = registerList({ '!': { l: { Attachment: 'image' } } });

    await revalidateMailAttachmentListsForSoupUpdates(
      [thread([{ mimeType: 'application/pdf' }])],
      true
    );

    expect(pdfs).toHaveBeenCalledTimes(1);
    expect(either).toHaveBeenCalledTimes(1);
    expect(negated).toHaveBeenCalledTimes(1);
    expect(unfiltered).not.toHaveBeenCalled();
  });

  it('ignores threads without attachments and other patches', async () => {
    const pdfs = registerList(PDFS);

    await revalidateMailAttachmentListsForSoupUpdates(
      [
        thread([]),
        {
          __typename: 'GraphqlCacheDeletion',
          graphqlTypeName: 'GraphqlSoupEmailThread',
          entityId: crypto.randomUUID(),
        },
      ],
      false
    );

    expect(pdfs).not.toHaveBeenCalled();
  });

  it('leaves a list the cache keeps current alone', async () => {
    const maintained = registerList(PDFS, { cacheMaintained: () => true });

    await revalidateMailAttachmentListsForSoupUpdates(
      [thread([{ mimeType: 'application/pdf' }])],
      true
    );

    expect(maintained).not.toHaveBeenCalled();
  });

  it('refreshes a maintained list when the cache did not take the push', async () => {
    const maintained = registerList(PDFS, { cacheMaintained: () => true });

    await revalidateMailAttachmentListsForSoupUpdates(
      [thread([{ mimeType: 'application/pdf' }])],
      false
    );

    expect(maintained).toHaveBeenCalledTimes(1);
  });
});
