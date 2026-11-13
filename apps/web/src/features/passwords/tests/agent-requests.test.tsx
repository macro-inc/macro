import type { PasswordAgentAccessRequestState } from '@service-storage/generated/schemas/passwordAgentAccessRequestState';
import type { PasswordAgentResolveRequest } from '@service-storage/generated/schemas/passwordAgentResolveRequest';
import type { PasswordAgentRevokeBody } from '@service-storage/generated/schemas/passwordAgentRevokeBody';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import userEvent from '@testing-library/user-event';
import { err, ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { PasswordsProvider } from '../context/passwords-context';
import type {
  AgentRequestFailure,
  AgentRequestSource,
} from '../queries/agent-requests';
import { ItemAgentRequests } from '../views/item-agent-requests';
import { createFakePasswordSource } from './fake-source';
import { FIXTURE_SCOPE } from './fixture-scope';

afterEach(cleanup);

const ITEM = '019a0000-0000-7000-8000-000000000100';
const REQUEST = '019a0000-0000-7000-8000-000000000200';
const AGENT = 'macro|agent-reviewed@example.test';

function state(
  overrides: Partial<PasswordAgentAccessRequestState>
): PasswordAgentAccessRequestState {
  return {
    requestId: null,
    itemId: ITEM,
    agentAccountId: AGENT,
    permission: null,
    status: 'none',
    revision: 0,
    updatedAt: null,
    ...overrides,
    access: {
      status: 'request_access',
      useBasis: null,
      canUpdate: false,
      canSetTotp: false,
      permissionRevision: 0,
      pendingRequestId: null,
      ...overrides.access,
    },
  };
}

const PENDING = state({
  requestId: REQUEST,
  permission: 'edit',
  status: 'pending',
  revision: 3,
  access: {
    status: 'pending',
    useBasis: null,
    canUpdate: false,
    canSetTotp: false,
    permissionRevision: 1,
    pendingRequestId: REQUEST,
  },
});
const APPROVED = state({
  requestId: REQUEST,
  permission: 'view',
  status: 'approved',
  revision: 4,
  access: {
    status: 'usable',
    useBasis: 'approved_grant',
    canUpdate: false,
    canSetTotp: false,
    permissionRevision: 7,
    pendingRequestId: null,
  },
});
const CREATOR = state({
  access: {
    status: 'usable',
    useBasis: 'creator_grant',
    canUpdate: true,
    canSetTotp: true,
    permissionRevision: 2,
    pendingRequestId: null,
  },
});

/** A review source over fixed pages, recording every mutation it is asked for. */
function fakeSource(
  pages: Array<PasswordAgentAccessRequestState[] | AgentRequestFailure>,
  answer: AgentRequestFailure | undefined = undefined
) {
  let listed: () => void = () => {};
  const calls = {
    /** Resolves once the next list request has been answered. */
    nextList: () =>
      new Promise<void>((resolve) => {
        listed = resolve;
      }),
    lists: 0,
    resolves: [] as Array<{
      requestId: string;
      body: PasswordAgentResolveRequest;
    }>,
    revokes: [] as Array<{ agent: string; body: PasswordAgentRevokeBody }>,
  };
  const source: AgentRequestSource = {
    async forItem(itemId) {
      expect(itemId).toBe(ITEM);
      const page = pages[Math.min(calls.lists, pages.length - 1)];
      calls.lists++;
      queueMicrotask(listed);
      return typeof page === 'string' ? err(page) : ok(page);
    },
    async resolve(itemId, requestId, body) {
      expect(itemId).toBe(ITEM);
      calls.resolves.push({ requestId, body });
      return answer ? err(answer) : ok(APPROVED);
    },
    async revoke(itemId, agent, body) {
      expect(itemId).toBe(ITEM);
      calls.revokes.push({ agent, body });
      return answer ? err(answer) : ok(CREATOR.access);
    },
  };
  return { source, calls };
}

function mount(source: AgentRequestSource) {
  render(() => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <style>
        {'[role="menu"] { animation-name: none; transition-duration: 0s; }'}
      </style>
      <PasswordsProvider
        value={{
          scope: FIXTURE_SCOPE,
          source: createFakePasswordSource(),
          recipients: () => [],
          recipientsLoading: () => false,
          recipientsError: () => false,
          writeClipboard: async () => {},
          displayName: (accountId) => accountId.replace(/^macro\|/, ''),
        }}
      >
        <ItemAgentRequests source={source} itemId={ITEM} />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
}

it('approves a pending request with the chosen permission and the revision it showed', async () => {
  const { source, calls } = fakeSource([[PENDING], [APPROVED]]);
  mount(source);
  expect(await screen.findByText(/asked to edit this item/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Allow view' }));
  expect(await screen.findByText(/can view this item/)).toBeTruthy();
  expect(calls.resolves).toEqual([
    {
      requestId: REQUEST,
      body: { decision: 'approve', revision: 3, permission: 'view' },
    },
  ]);
  expect(calls.lists).toBe(2);
});

it('denies a pending request and the agent leaves the list', async () => {
  const { source, calls } = fakeSource([
    [PENDING],
    [state({ status: 'denied' })],
  ]);
  mount(source);
  const row = await screen.findByText(/asked to edit this item/);
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
  await waitForElementToBeRemoved(row);
  expect(calls.resolves).toEqual([
    { requestId: REQUEST, body: { decision: 'deny', revision: 3 } },
  ]);
  expect(screen.queryByRole('region', { name: 'Agent access' })).toBeNull();
});

it('revokes an approved agent by approval or grant, and a creator only by grant', async () => {
  const user = userEvent.setup();
  const { source, calls } = fakeSource([[APPROVED, CREATOR]]);
  mount(source);
  await screen.findByText(/can view this item/);
  const [approvedRevoke, creatorRevoke] = screen.getAllByRole('button', {
    name: /^Revoke access for/,
  });
  await user.click(creatorRevoke);
  expect(
    screen.queryByRole('menuitem', { name: 'Remove approval' })
  ).toBeNull();
  const removeAccess = await screen.findByRole('menuitem', {
    name: 'Remove access',
  });
  const creatorMenuClosed = waitForElementToBeRemoved(removeAccess);
  await user.keyboard('{Escape}');
  await creatorMenuClosed;
  await user.click(approvedRevoke);
  await user.click(
    await screen.findByRole('menuitem', { name: 'Remove approval' })
  );
  await screen.findByText(/can view this item/);
  expect(calls.revokes).toEqual([
    {
      agent: AGENT,
      body: { expectedPermissionRevision: 7, scope: 'approval' },
    },
  ]);
});

it('a request that changed since it was shown says so and shows the latest', async () => {
  const { source, calls } = fakeSource([[PENDING], [APPROVED]], 'stale');
  mount(source);
  await screen.findByText(/asked to edit this item/);
  fireEvent.click(screen.getByRole('button', { name: 'Allow edit' }));
  expect(
    await screen.findByText('This request changed. Showing the latest.')
  ).toBeTruthy();
  expect(await screen.findByText(/can view this item/)).toBeTruthy();
  expect(calls.lists).toBe(2);
});

it('shows nothing when the agent vault is off or the viewer cannot review', async () => {
  const { source, calls } = fakeSource(['unavailable']);
  const listed = calls.nextList();
  mount(source);
  await listed;
  expect(calls.lists).toBe(1);
  expect(screen.queryByRole('region', { name: 'Agent access' })).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it('says a decision did not go through and keeps the controls to retry', async () => {
  const { source, calls } = fakeSource([[PENDING]], 'failed');
  mount(source);
  await screen.findByText(
    'agent-reviewed@example.test asked to edit this item'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Allow view' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'That did not go through. Try again.'
  );
  expect(screen.getByRole('button', { name: 'Allow view' })).toBeTruthy();
  expect(calls.resolves).toHaveLength(1);
});

it('keeps the item on screen while its agent list loads', async () => {
  let answer: (() => void) | undefined;
  const { source } = fakeSource([[PENDING]]);
  const forItem = source.forItem;
  source.forItem = (itemId) =>
    new Promise((resolve) => {
      answer = () => resolve(forItem(itemId));
    });
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <Suspense fallback={<p>vault loading</p>}>
        <p>item detail</p>
        <PasswordsProvider
          value={{
            scope: FIXTURE_SCOPE,
            source: createFakePasswordSource(),
            recipients: () => [],
            recipientsLoading: () => false,
            recipientsError: () => false,
            writeClipboard: async () => {},
            displayName: (accountId) => accountId.replace(/^macro\|/, ''),
          }}
        >
          <ItemAgentRequests source={source} itemId={ITEM} />
        </PasswordsProvider>
      </Suspense>
    </QueryClientProvider>
  ));
  expect(screen.getByText('item detail')).toBeTruthy();
  expect(screen.queryByText('vault loading')).toBeNull();
  answer?.();
  expect(await screen.findByText(/asked to edit this item/)).toBeTruthy();
});
