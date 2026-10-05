import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  patchTutorial: vi.fn(),
  client: undefined as QueryClient | undefined,
}));
vi.mock('../client', () => ({
  get queryClient() {
    return mocks.client;
  },
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { patchUserTutorial: mocks.patchTutorial },
}));

import { authKeys } from './keys';
import { useCompleteTutorialMutation } from './tutorial';

afterEach(() => {
  cleanup();
  mocks.client?.clear();
  vi.clearAllMocks();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.client = client;
  const user = { userId: 'macro|test@example.com', tutorialComplete: false };
  client.setQueryData(authKeys.userInfo.queryKey, user);
  let complete!: () => Promise<void>;
  function Harness() {
    const mutation = useCompleteTutorialMutation();
    complete = () => mutation.mutateAsync();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  return { client, user, complete };
}

it('publishes the saved tutorial flag before completion resolves, despite an older user-info refresh', async () => {
  const { client, user, complete } = setup();
  const background = Promise.withResolvers<typeof user>();
  const request = client
    .fetchQuery({
      queryKey: authKeys.userInfo.queryKey,
      queryFn: () => background.promise,
    })
    .catch(() => undefined);
  mocks.patchTutorial.mockResolvedValue(ok(undefined));

  await complete();
  expect(client.getQueryData(authKeys.userInfo.queryKey)).toEqual({
    ...user,
    tutorialComplete: true,
  });

  background.resolve(user);
  await request;
  expect(client.getQueryData(authKeys.userInfo.queryKey)).toEqual({
    ...user,
    tutorialComplete: true,
  });
});

it('keeps onboarding incomplete when the tutorial save fails', async () => {
  const { client, user, complete } = setup();
  mocks.patchTutorial.mockResolvedValue(
    err([{ code: 'SERVER_ERROR', message: 'Save failed' }])
  );

  await expect(complete()).rejects.toThrow();
  expect(client.getQueryData(authKeys.userInfo.queryKey)).toEqual(user);
});

it('does not complete a different account that signs in while the save is pending', async () => {
  const { client, complete } = setup();
  const saved = Promise.withResolvers<ReturnType<typeof ok<void>>>();
  mocks.patchTutorial.mockReturnValue(saved.promise);
  const completion = complete();
  await vi.waitFor(() => expect(mocks.patchTutorial).toHaveBeenCalledOnce());
  const otherUser = {
    userId: 'macro|other@example.com',
    tutorialComplete: false,
  };
  client.setQueryData(authKeys.userInfo.queryKey, otherUser);

  saved.resolve(ok(undefined));
  await completion;
  expect(client.getQueryData(authKeys.userInfo.queryKey)).toEqual(otherUser);
});
