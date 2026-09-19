import type { EntityData } from '@entity';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  blockSenderWithToast: vi.fn(async () => {}),
  filterAction: vi.fn(async () => {}),
  primaryLinkId: 'link-primary',
}));

vi.mock('@queries/email/link', () => ({
  // Mirrors the real hook: the primary inbox's link id maps to `undefined`
  // (the backend defaults to primary when the header is absent).
  useNonPrimaryEmailLinkIdHeader: () => (linkId: string | undefined | null) =>
    !linkId || linkId === mocks.primaryLinkId ? undefined : linkId,
}));

vi.mock('@queries/email/thread', () => ({
  blockSenderWithToast: mocks.blockSenderWithToast,
}));

import { makeBlockSenderAction } from './make-block-sender-action';
import { makeSenderFilterAction } from './make-sender-filter-action';

const emailEntity = (over: Partial<EntityData> = {}) =>
  ({
    type: 'email',
    id: 'thread-1',
    senderEmail: 'sender@example.com',
    ...over,
  }) as EntityData;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('makeSenderFilterAction', () => {
  it('sends the thread inbox link id for a non-primary inbox', async () => {
    await createRoot(async (dispose) => {
      const action = makeSenderFilterAction(mocks.filterAction);
      await action.execute([emailEntity({ linkId: 'link-secondary' })]);
      dispose();
    });

    expect(mocks.filterAction).toHaveBeenCalledWith(
      'sender@example.com',
      'link-secondary'
    );
  });

  it('omits the link id for the primary inbox', async () => {
    await createRoot(async (dispose) => {
      const action = makeSenderFilterAction(mocks.filterAction);
      await action.execute([emailEntity({ linkId: mocks.primaryLinkId })]);
      dispose();
    });

    expect(mocks.filterAction).toHaveBeenCalledWith(
      'sender@example.com',
      undefined
    );
  });

  it('keys the dedupe on the inbox so one sender in two inboxes is two filters', async () => {
    await createRoot(async (dispose) => {
      const action = makeSenderFilterAction(mocks.filterAction);
      await action.execute([
        emailEntity({ id: 'a', linkId: 'link-a' }),
        emailEntity({ id: 'b', linkId: 'link-b' }),
        emailEntity({ id: 'c', linkId: 'link-a' }),
      ]);
      dispose();
    });

    expect(mocks.filterAction).toHaveBeenCalledTimes(2);
    expect(mocks.filterAction).toHaveBeenCalledWith(
      'sender@example.com',
      'link-a'
    );
    expect(mocks.filterAction).toHaveBeenCalledWith(
      'sender@example.com',
      'link-b'
    );
  });

  it('collapses a missing link id and an explicit primary one into one request', async () => {
    await createRoot(async (dispose) => {
      const action = makeSenderFilterAction(mocks.filterAction);
      await action.execute([
        emailEntity({ id: 'a', linkId: undefined }),
        emailEntity({ id: 'b', linkId: mocks.primaryLinkId }),
      ]);
      dispose();
    });

    expect(mocks.filterAction).toHaveBeenCalledTimes(1);
    expect(mocks.filterAction).toHaveBeenCalledWith(
      'sender@example.com',
      undefined
    );
  });
});

describe('makeBlockSenderAction', () => {
  it('blocks on the inbox the thread belongs to', async () => {
    await createRoot(async (dispose) => {
      const action = makeBlockSenderAction();
      await action.execute([
        emailEntity({ id: 'a', linkId: 'link-secondary' }),
        emailEntity({ id: 'b', linkId: mocks.primaryLinkId }),
      ]);
      dispose();
    });

    expect(mocks.blockSenderWithToast).toHaveBeenNthCalledWith(
      1,
      'sender@example.com',
      'link-secondary'
    );
    expect(mocks.blockSenderWithToast).toHaveBeenNthCalledWith(
      2,
      'sender@example.com',
      undefined
    );
  });
});
