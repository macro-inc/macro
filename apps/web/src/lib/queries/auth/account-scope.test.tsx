import { scheduledActionKeys } from '@app/features/routines/queries/keys';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { batch, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useListChannelsQuery } from '../channel/channels';
import { channelKeys } from '../channel/keys';
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
  channels: vi.fn(),
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
  storageServiceClient: { getChannels: api.channels },
}));
vi.mock('../email/mail-accounts', () => ({ refreshMailAccounts: api.refresh }));
vi.mock('./user-info', () => ({ invalidateUserInfo: vi.fn() }));
vi.mock('../calendar/sync', () => ({ invalidateCalendarViews: vi.fn() }));
vi.mock('../soup/normalized-cache', () => ({ invalidateAllSoup: vi.fn() }));

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
  const lateChannels =
    Promise.withResolvers<
      Ok<{ items: { id: string }[]; next_cursor: null }, unknown>
    >();
  api.links
    .mockResolvedValueOnce(ok({ links: [{ id: 'one-inbox' }] }))
    .mockReturnValueOnce(lateLinks.promise)
    .mockResolvedValueOnce(ok({ links: [{ id: 'two-inbox' }] }));
  api.channels
    .mockResolvedValueOnce(
      ok({ items: [{ id: 'one-channel' }], next_cursor: null })
    )
    .mockReturnValueOnce(lateChannels.promise)
    .mockResolvedValueOnce(
      ok({ items: [{ id: 'two-channel' }], next_cursor: null })
    );
  client.setQueryData(emailKeys.links._def, {
    links: [{ id: 'legacy-inbox' }],
  });
  client.setQueryData(channelKeys.listChannels._def, [
    { id: 'legacy-channel' },
  ]);
  function Lists() {
    const links = useEmailLinksQuery();
    const channels = useListChannelsQuery();
    return (
      <output>
        {JSON.stringify([
          links.isPending ? [] : links.data?.links.map((link) => link.id),
          channels.isPending ? [] : channels.data?.map((channel) => channel.id),
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
  await vi.waitFor(() => expect(api.channels).toHaveBeenCalledTimes(2));
  batch(() => {
    client.setQueryData(authKeys.userInfo.queryKey, {
      id: 'macro|two@example.com',
      authenticated: true,
    });
    setViewer('macro|two@example.com');
  });
  await view.findByText('[["two-inbox"],["two-channel"]]');
  lateLinks.resolve(ok({ links: [{ id: 'late-private-inbox' }] }));
  lateChannels.resolve(
    ok({ items: [{ id: 'late-private-channel' }], next_cursor: null })
  );
  await oldRefresh;
  expect(view.container.textContent).toBe('[["two-inbox"],["two-channel"]]');
  expect(client.getQueryData(emailKeys.links(viewer()).queryKey)).toEqual({
    links: [{ id: 'two-inbox' }],
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
