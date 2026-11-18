import { queryClient } from '@queries/client';
import { pullRequestMentionKeys } from '@queries/storage/keys';
import { render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getForeignEntity: vi.fn(),
  getForeignEntityBySource: vi.fn(),
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getForeignEntity: mocks.getForeignEntity,
    getForeignEntityBySource: mocks.getForeignEntityBySource,
  },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@queries/auth/github-link', () => ({
  useGithubLinkStatusQuery: () => ({
    isPending: false,
    data: { status: 'linked' },
  }),
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element }) => props.trigger,
}));
vi.mock('../../plugins', () => ({ autoRegister: vi.fn() }));
vi.mock('../../context/LexicalWrapperContext', async () => {
  const { createContext } = await import('solid-js');
  return { LexicalWrapperContext: createContext() };
});

import { PullRequestMention } from './PullRequestMention';

const URL = 'https://github.com/example/repo/pull/1';

beforeEach(() => {
  queryClient.clear();
  mocks.getForeignEntity.mockReset();
  mocks.getForeignEntityBySource.mockReset();
  mocks.getForeignEntity.mockResolvedValue(err([{ code: 'NOT_FOUND' }]));
  mocks.getForeignEntityBySource.mockResolvedValue(
    err([{ code: 'NOT_FOUND' }])
  );
});

// Source skips the id lookup for a stored null or omitted id and resolves the
// mention from its URL instead.
it.each([null, undefined])(
  'looks a stored %s id up by its URL only',
  async (id) => {
    render(() => (
      <QueryClientProvider client={queryClient}>
        <PullRequestMention
          id={id}
          url={URL}
          label="Probe PR #1"
          key="node"
          theme={{}}
        />
      </QueryClientProvider>
    ));

    await waitFor(() =>
      expect(mocks.getForeignEntityBySource).toHaveBeenCalledWith({
        source: 'github_pull_request',
        foreignEntityId: 'example/repo/pull/1',
      })
    );
    expect(mocks.getForeignEntity).not.toHaveBeenCalled();
  }
);

it('looks a stored id up by id and not by its URL', async () => {
  render(() => (
    <QueryClientProvider client={queryClient}>
      <PullRequestMention
        id="probe-pr"
        url={URL}
        label="Probe PR #1"
        key="node"
        theme={{}}
      />
    </QueryClientProvider>
  ));

  await waitFor(() =>
    expect(mocks.getForeignEntity).toHaveBeenCalledWith({ id: 'probe-pr' })
  );
  expect(mocks.getForeignEntityBySource).not.toHaveBeenCalled();
});

it('keys a stored id under the same prefix as the id key', () => {
  expect([...pullRequestMentionKeys.foreignEntity._def, 'probe-pr']).toEqual(
    pullRequestMentionKeys.foreignEntity('probe-pr').queryKey
  );
});

it('keeps a stored null id apart from the text "null"', async () => {
  mocks.getForeignEntity.mockResolvedValue(ok({ id: 'null' }));
  render(() => (
    <QueryClientProvider client={queryClient}>
      <PullRequestMention id={null} url={URL} label="Null" key="a" theme={{}} />
      <PullRequestMention id="null" url={URL} label="Text" key="b" theme={{}} />
    </QueryClientProvider>
  ));

  await waitFor(() =>
    expect(mocks.getForeignEntity).toHaveBeenCalledWith({ id: 'null' })
  );
  expect(mocks.getForeignEntity).toHaveBeenCalledTimes(1);
  expect(
    queryClient
      .getQueryCache()
      .findAll({ queryKey: pullRequestMentionKeys.foreignEntity._def })
      .map((query) => query.queryKey.at(-1))
  ).toEqual([null, 'null']);
});
