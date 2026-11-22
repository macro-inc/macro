import { scheduledActionKeys } from '@app/features/routines/queries/keys';
import { cleanup, render } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import { type Ok, ok } from 'neverthrow';
import { batch, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fromPromise } from 'wonka';
import { channelDirectoryPagesQueryOptions } from '../channel/directory';
import { channelKeys } from '../channel/keys';
import { ownChannelWrites } from '../channel/own-writes';
import { channelName, channelUuid } from '../channel/tests/channel-uuid';
import { channelRecord } from '../channel/tests/directory-fixtures';
import { emailKeys } from '../email/keys';
import {
  emailLinksQueryOptions,
  useEmailLinksQuery,
  useRemoveInboxMutation,
} from '../email/link';
import { useUpdateEmailSettingsMutation } from '../email/settings';
import { currentQueryAccount, resetQueryAccountSession } from './account-scope';
import { authKeys } from './keys';

const api = vi.hoisted(() => ({
  links: vi.fn(),
  channelPages: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
}));
const [viewer, setViewer] = createSignal('macro|one@example.com');
let client: QueryClient;
vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => viewer,
  useIsAuthenticated: () => () => true,
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    getLinks: api.links,
    patchSettings: api.patch,
    deleteLink: api.remove,
  },
  SIGNATURE_IMAGES_UNRESOLVED_CODE: 'SIGNATURE_IMAGES_UNRESOLVED',
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {},
}));
vi.mock('../email/mail-accounts', () => ({ refreshMailAccounts: api.refresh }));
vi.mock('./user-info', () => ({ invalidateUserInfo: vi.fn() }));
vi.mock('../calendar/sync', () => ({ invalidateCalendarViews: vi.fn() }));
vi.mock('../soup/normalized-cache', () => ({ invalidateAllSoup: vi.fn() }));

/** The soup client the directory pages read through: each read answers
 * with `api.channelPages`'s next result. */
const soupClient = {
  query: () => fromPromise(api.channelPages()),
} as unknown as Pick<Client, 'query'>;

/** One directory page holding `names`'s channels, with no page after it. */
const channelPage = (...names: string[]) => ({
  data: {
    user: {
      soup: {
        items: names.map((name) => channelRecord(channelUuid(name))),
        nextCursor: null,
      },
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  setViewer('macro|one@example.com');
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: viewer(),
    authenticated: true,
  });
  api.links.mockResolvedValue(ok({ links: [] }));
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('switches mounted lists without exposing legacy or previous-account rows', async () => {
  const lateLinks =
    Promise.withResolvers<Ok<{ links: { id: string }[] }, unknown>>();
  const lateChannels = Promise.withResolvers<ReturnType<typeof channelPage>>();
  api.links
    .mockResolvedValueOnce(ok({ links: [{ id: 'one-inbox' }] }))
    .mockReturnValueOnce(lateLinks.promise)
    .mockResolvedValueOnce(ok({ links: [{ id: 'two-inbox' }] }));
  api.channelPages
    .mockResolvedValueOnce(channelPage('one-channel'))
    .mockReturnValueOnce(lateChannels.promise)
    .mockResolvedValueOnce(channelPage('two-channel'));
  client.setQueryData(emailKeys.links._def, {
    links: [{ id: 'legacy-inbox' }],
  });
  client.setQueryData(channelKeys.directory._def, [
    { id: channelUuid('legacy') },
  ]);
  function Lists() {
    const links = useEmailLinksQuery();
    const channels = useQuery(() =>
      channelDirectoryPagesQueryOptions(viewer(), () => soupClient)
    );
    return (
      <output>
        {JSON.stringify([
          links.isPending ? [] : links.data?.links.map((link) => link.id),
          channels.isPending
            ? []
            : channels.data?.map((channel) => channelName(channel.id)),
        ])}
      </output>
    );
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Lists />
    </QueryClientProvider>
  ));
  await view.findByText('[["one-inbox"],["one-channel"]]');
  const oldRefresh = client.refetchQueries();
  await vi.waitFor(() => {
    expect(api.links).toHaveBeenCalledTimes(2);
    expect(api.channelPages).toHaveBeenCalledTimes(2);
  });
  batch(() => {
    client.setQueryData(authKeys.userInfo.queryKey, {
      id: 'macro|two@example.com',
      authenticated: true,
    });
    setViewer('macro|two@example.com');
  });
  await view.findByText('[["two-inbox"],["two-channel"]]');
  lateLinks.resolve(ok({ links: [{ id: 'late-private-inbox' }] }));
  lateChannels.resolve(channelPage('late-channel'));
  await oldRefresh;
  expect(view.container.textContent).toBe('[["two-inbox"],["two-channel"]]');
  expect(client.getQueryData(emailKeys.links(viewer()).queryKey)).toEqual({
    links: [{ id: 'two-inbox' }],
  });
  expect(
    client
      .getQueryData<{ id: string }[]>(channelKeys.directory(viewer()).queryKey)
      ?.map((channel) => channelName(channel.id))
  ).toEqual(['two-channel']);
});

it("leaves the previous account's cached inboxes alone when the mounted inbox list switches accounts", () => {
  const one = viewer();
  const two = 'macro|two@example.com';
  client.setQueryData(emailKeys.links(one).queryKey, {
    links: [{ id: 'shared-inbox', settings: { signature: 'one' } }],
  });
  client.setQueryData(emailKeys.links(two).queryKey, {
    links: [{ id: 'shared-inbox', settings: { signature: 'two' } }],
  });
  function Signatures() {
    const links = useEmailLinksQuery();
    return (
      <>
        {links.isSuccess
          ? links.data.links.map((link) => link.settings?.signature).join()
          : ''}
      </>
    );
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Signatures />
    </QueryClientProvider>
  ));
  expect(view.container.textContent).toBe('one');
  // The hook reconciles rows by id in place; it must do so on its own copy.
  batch(() => {
    client.setQueryData(authKeys.userInfo.queryKey, {
      id: two,
      authenticated: true,
    });
    setViewer(two);
  });
  expect(view.container.textContent).toBe('two');
  expect(client.getQueryData(emailKeys.links(one).queryKey)).toEqual({
    links: [{ id: 'shared-inbox', settings: { signature: 'one' } }],
  });
});

it('drops late settings results even after the mutation observer adopts another account', async () => {
  const pending =
    Promise.withResolvers<Ok<{ settings: { signature: string } }, unknown>>();
  api.patch.mockReturnValue(pending.promise);
  const one = viewer();
  const two = 'macro|two@example.com';
  client.setQueryData(emailKeys.links(one).queryKey, {
    links: [{ id: 'shared-inbox', settings: { signature: 'one' } }],
  });
  client.setQueryData(emailKeys.links(two).queryKey, {
    links: [{ id: 'shared-inbox', settings: { signature: 'two' } }],
  });
  let mutation!: ReturnType<typeof useUpdateEmailSettingsMutation>;
  function Editor() {
    mutation = useUpdateEmailSettingsMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Editor />
    </QueryClientProvider>
  ));
  const save = mutation.mutateAsync({
    linkId: 'shared-inbox',
    settings: { signature: 'new-private-value' },
  });
  await vi.waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
  batch(() => {
    client.setQueryData(authKeys.userInfo.queryKey, {
      id: two,
      authenticated: true,
    });
    setViewer(two);
  });
  pending.resolve(ok({ settings: { signature: 'new-private-value' } }));
  await save;
  expect(client.getQueryData(emailKeys.links(two).queryKey)).toEqual({
    links: [{ id: 'shared-inbox', settings: { signature: 'two' } }],
  });
  expect(client.getQueryData(emailKeys.links(one).queryKey)).toEqual({
    links: [{ id: 'shared-inbox', settings: { signature: 'one' } }],
  });
  expect(api.refresh).not.toHaveBeenCalled();
});

it('does not roll an old inbox snapshot into a replacement account', async () => {
  const pending = Promise.withResolvers<never>();
  api.remove.mockReturnValue(pending.promise);
  client.setQueryData(emailKeys.links(viewer()).queryKey, {
    links: [{ id: 'inbox', settings: { signature: 'private old' } }],
  });
  let mutation!: ReturnType<typeof useRemoveInboxMutation>;
  function Editor() {
    mutation = useRemoveInboxMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Editor />
    </QueryClientProvider>
  ));
  const removing = mutation.mutateAsync('inbox');
  const rejected = expect(removing).rejects.toThrow('failed');
  await vi.waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
  batch(() => {
    client.setQueryData(authKeys.userInfo.queryKey, {
      id: 'macro|two@example.com',
      authenticated: true,
    });
    setViewer('macro|two@example.com');
  });
  client.setQueryData(emailKeys.links(viewer()).queryKey, {
    links: [{ id: 'inbox', settings: { signature: 'new account' } }],
  });
  pending.reject(new Error('failed'));
  await rejected;
  expect(client.getQueryData(emailKeys.links(viewer()).queryKey)).toEqual({
    links: [{ id: 'inbox', settings: { signature: 'new account' } }],
  });
});

it('does not send an old removal after cancellation awaits across an account switch', async () => {
  const canceled = Promise.withResolvers<void>();
  vi.spyOn(client, 'cancelQueries').mockReturnValue(canceled.promise);
  let mutation!: ReturnType<typeof useRemoveInboxMutation>;
  function Editor() {
    mutation = useRemoveInboxMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Editor />
    </QueryClientProvider>
  ));
  const removing = mutation.mutateAsync('inbox');
  const rejected = expect(removing).rejects.toThrow('Query account changed');
  await vi.waitFor(() => expect(client.cancelQueries).toHaveBeenCalledOnce());
  batch(() => {
    client.setQueryData(authKeys.userInfo.queryKey, {
      id: 'macro|two@example.com',
      authenticated: true,
    });
    setViewer('macro|two@example.com');
  });
  canceled.resolve();
  await rejected;
  expect(api.remove).not.toHaveBeenCalled();
});

it('keeps retained identity for the shell but gates source reads until fresh login confirmation', async () => {
  const owner = currentQueryAccount();
  const late = Promise.withResolvers<Ok<{ links: never[] }, unknown>>();
  api.links.mockReturnValue(late.promise);
  const reading = client.fetchQuery(emailLinksQueryOptions(owner, true));
  const rejected = expect(reading).rejects.toBeDefined();
  await resetQueryAccountSession();
  expect(currentQueryAccount()).toBeUndefined();
  expect(client.getQueryData(authKeys.userInfo.queryKey)).toMatchObject({
    id: viewer(),
  });
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: viewer(),
    authenticated: true,
  });
  expect(currentQueryAccount()).toBeUndefined();
  await client.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () => ({ id: viewer(), authenticated: true }),
    staleTime: 0,
  });
  expect(currentQueryAccount()?.userId).toBe(owner?.userId);
  expect(currentQueryAccount()?.session).not.toBe(owner?.session);
  late.resolve(ok({ links: [] }));
  await rejected;
  expect(
    client.getQueryData(emailKeys.links(viewer()).queryKey)
  ).toBeUndefined();
});

it('forgets the previous account’s routine drafts', async () => {
  const key = scheduledActionKeys.draftJobs.queryKey;
  client.setQueryData(key, [{ id: 'draft-1', state: 'drafting' }]);
  await resetQueryAccountSession();
  expect(client.getQueryData(key)).toBeUndefined();
});

// Directories ignore another sign-in's writes, but the store kept them, their
// hold timers and the reads in flight until each hold ended.
it('forgets the channel writes the previous sign-in made', async () => {
  const own = ownChannelWrites(client);
  const account = { userId: viewer(), session: 0 };
  own.send(account, ['channel-1']).settle({ 'channel-1': null });
  const late = own.send(account, ['channel-2']);
  expect(Object.keys(own.writes())).toEqual(['channel-1']);

  await resetQueryAccountSession();
  late.settle({ 'channel-2': null });

  expect(own.writes()).toEqual({});
  expect(own.inFlight()).toEqual([]);
});
