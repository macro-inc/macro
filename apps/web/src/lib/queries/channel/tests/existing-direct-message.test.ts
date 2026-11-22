import { QueryClient } from '@tanstack/solid-query';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  fromValue,
  lazy,
  make,
  pipe,
  type Source,
  take,
  toPromise,
} from 'wonka';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  client: undefined as QueryClient | undefined,
}));
vi.mock('../../client', () => ({
  get queryClient() {
    return mocks.client;
  },
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: mocks.query }),
}));
vi.mock('../directory', () => ({
  refreshChannelDirectory: vi.fn(async () => undefined),
}));

import { QueryAccountChangedError } from '../../auth/account-scope';
import { authKeys } from '../../auth/keys';
import {
  DirectMessageLookupTimedOut,
  DM_LOOKUP_DEADLINE_MS,
  existingDirectMessage,
} from '../get-or-create-dm';
import { directoryChannel, directoryParticipant } from './directory-channel';

const VIEWER = 'macro|viewer@example.com';
const PERSON = 'macro|person@example.com';

/** A query's result source as urql returns it, with its own toPromise. */
function urqlSource<T>(source: Source<T>) {
  return Object.assign(source, {
    toPromise: () => pipe(source, take(1), toPromise),
  });
}

function answers(result: object) {
  mocks.query.mockReturnValue(urqlSource(fromValue(result)));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = new QueryClient();
  mocks.client.setQueryData(authKeys.userInfo.queryKey, {
    id: VIEWER,
    authenticated: true,
  });
});

it('asks the server for the DM with a person, skipping every cache', async () => {
  answers({ data: { user: { id: VIEWER, directMessageChannelId: 'dm-1' } } });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found._unsafeUnwrap()).toEqual({
    channelId: 'dm-1',
    source: 'server',
  });
  expect(mocks.query).toHaveBeenCalledWith(
    expect.anything(),
    { userId: PERSON },
    { requestPolicy: 'network-only' }
  );
});

it('answers none when the server has no DM with that person', async () => {
  answers({ data: { user: { id: VIEWER, directMessageChannelId: null } } });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found._unsafeUnwrap().channelId).toBeUndefined();
});

it.each([
  ['the viewer', VIEWER],
  ['an agent', 'bot|0190f0a0-0000-7000-8000-000000000001'],
])('answers none for %s without asking', async (_, recipient) => {
  const found = await existingDirectMessage(VIEWER, recipient);
  expect(found._unsafeUnwrap().channelId).toBeUndefined();
  expect(mocks.query).not.toHaveBeenCalled();
});

it('fails when the lookup fails, so the opener can still show an empty DM', async () => {
  const error = new Error('lookup failed');
  answers({ error });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found._unsafeUnwrapErr()).toBe(error);
});

it('fails when another account signed in during the lookup', async () => {
  mocks.query.mockReturnValue(
    urqlSource(
      lazy(() => {
        mocks.client?.setQueryData(authKeys.userInfo.queryKey, {
          id: 'macro|other@example.com',
          authenticated: true,
        });
        return fromValue({
          data: { user: { id: VIEWER, directMessageChannelId: 'dm-1' } },
        });
      })
    )
  );
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found.isErr()).toBe(true);
});

it('fails without asking when the viewer is no longer the one signed in', async () => {
  mocks.client?.setQueryData(authKeys.userInfo.queryKey, {
    id: 'macro|other@example.com',
    authenticated: true,
  });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found._unsafeUnwrapErr()).toBeInstanceOf(QueryAccountChangedError);
  expect(mocks.query).not.toHaveBeenCalled();
});

it('gives up on a lookup that never answers at its deadline, ending the request', async () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const deadlines: AbortController[] = [];
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    if (ms !== DM_LOOKUP_DEADLINE_MS) return realTimeout(ms);
    const deadline = new AbortController();
    deadlines.push(deadline);
    return deadline.signal;
  });
  const ended = vi.fn();
  mocks.query.mockReturnValue(urqlSource(make(() => ended)));
  try {
    const lookup = existingDirectMessage(VIEWER, PERSON);
    await Promise.resolve();
    expect(deadlines).toHaveLength(1);
    expect(ended).not.toHaveBeenCalled();
    deadlines[0]?.abort();
    const found = await lookup;
    expect(found._unsafeUnwrapErr()).toBeInstanceOf(
      DirectMessageLookupTimedOut
    );
    expect(ended).toHaveBeenCalledOnce();
  } finally {
    timeout.mockRestore();
  }
});

function directoryWith(
  members: string[],
  { complete = true, viewsCurrent = true } = {}
) {
  return {
    complete: () => complete,
    viewsCurrent: () => viewsCurrent,
    channels: () => [
      directoryChannel('dm-cached', {
        channelType: 'direct_message',
        participants: members.map((userId) => directoryParticipant(userId)),
      }),
    ],
  };
}

it('answers from a settled directory that holds the DM, without asking', async () => {
  const found = await existingDirectMessage(
    VIEWER,
    PERSON,
    directoryWith([VIEWER, PERSON])
  );
  expect(found._unsafeUnwrap()).toEqual({
    channelId: 'dm-cached',
    source: 'directory',
  });
  expect(mocks.query).not.toHaveBeenCalled();
});

it('asks the server while the directory is incomplete', async () => {
  answers({ data: { user: { id: VIEWER, directMessageChannelId: 'dm-1' } } });
  const found = await existingDirectMessage(
    VIEWER,
    PERSON,
    directoryWith([VIEWER, PERSON], { complete: false })
  );
  expect(found._unsafeUnwrap()).toEqual({
    channelId: 'dm-1',
    source: 'server',
  });
});

it('asks the server until a pass of this page reconciled the cached records', async () => {
  // A DM deleted while no tab was open stays cached until that pass.
  answers({ data: { user: { id: VIEWER, directMessageChannelId: 'dm-1' } } });
  const found = await existingDirectMessage(
    VIEWER,
    PERSON,
    directoryWith([VIEWER, PERSON], { viewsCurrent: false })
  );
  expect(found._unsafeUnwrap()).toEqual({
    channelId: 'dm-1',
    source: 'server',
  });
});

it('asks the server when a settled directory has no DM it can rank', async () => {
  answers({ data: { user: { id: VIEWER, directMessageChannelId: 'dm-1' } } });
  const found = await existingDirectMessage(
    VIEWER,
    PERSON,
    directoryWith([VIEWER])
  );
  expect(found._unsafeUnwrap()).toEqual({
    channelId: 'dm-1',
    source: 'server',
  });
  expect(mocks.query).toHaveBeenCalledOnce();
});
