import { errAsync } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ existing: vi.fn() }));
vi.mock('@queries/channel/get-or-create-dm', () => ({
  existingDirectMessage: mocks.existing,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));

import { pendingDirectMessageId } from '@channel/primitives/pending-direct-messages';
import { QueryAccountChangedError } from '@queries/auth/account-scope';
import { openDirectMessage } from './open-direct-message';

const VIEWER = 'macro|viewer@example.com';
const PERSON = 'macro|person@example.com';

beforeEach(() => {
  vi.clearAllMocks();
});

it('opens nothing when the sign-in changed under the lookup', async () => {
  mocks.existing.mockReturnValue(errAsync(new QueryAccountChangedError()));
  const open = vi.fn();

  await openDirectMessage(VIEWER, PERSON, open);

  expect(open).not.toHaveBeenCalled();
});

it('opens a DM yet to be made when the lookup fails otherwise', async () => {
  mocks.existing.mockReturnValue(errAsync(new Error('lookup failed')));
  const open = vi.fn();

  await openDirectMessage(VIEWER, PERSON, open);

  expect(open).toHaveBeenCalledWith(
    { type: 'channel', id: pendingDirectMessageId(PERSON) },
    false
  );
});
