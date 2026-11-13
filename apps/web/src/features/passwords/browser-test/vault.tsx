import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import type { PasswordAgentAccessRequestState } from '@service-storage/generated/schemas/passwordAgentAccessRequestState';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { PasswordsProvider } from '../context/passwords-context';
import type { AgentRequestSource } from '../queries/agent-requests';
import { createFakePasswordSource } from '../tests/fake-source';
import { FIXTURE_SCOPE } from '../tests/fixture-scope';
import { focusFromParams, VaultView } from '../views/vault-view';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
// Shared with the viewer for viewing only: revealable, never editable.
const AGENT_ITEM = '019a0000-0000-7000-8000-0000000000bb';
const AGENT_REQUEST = '019a0000-0000-7000-8000-0000000000cc';
const source = createFakePasswordSource([
  // Managed by the viewer; an agent has asked to edit it.
  {
    item: {
      id: AGENT_ITEM,
      teamId: 'fixture-team',
      name: 'Agent requested login',
      kind: 'login',
      url: null,
      folderId: null,
      favorite: false,
      version: 1,
      hasTotp: false,
      shared: true,
      shareCount: 1,
      sharedWithTeam: true,
      canManage: true,
      canEdit: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    },
    values: {
      username: 'deploy-account',
      password: 'agent-requested-secret',
      notes: '',
      fields: [],
    },
  },
  {
    item: {
      id: '019a0000-0000-7000-8000-0000000000aa',
      teamId: 'fixture-team',
      name: 'View-only login',
      kind: 'login',
      url: null,
      folderId: null,
      favorite: false,
      version: 1,
      hasTotp: false,
      shared: true,
      shareCount: 1,
      sharedWithTeam: false,
      canManage: false,
      canEdit: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    },
    values: {
      username: 'viewer-account',
      password: 'view-only-secret',
      notes: '',
      fields: [],
    },
  },
]);
const search = new URLSearchParams(location.search);
/**
 * One agent's request on the managed item, moved through the backend's own
 * transitions: the row is kept as approved or revoked, and every change
 * advances its revisions. `?agentStale=1` has another reviewer approve view
 * just before the first decision, so that decision is stale.
 */
let agentState: PasswordAgentAccessRequestState = {
  requestId: AGENT_REQUEST,
  itemId: AGENT_ITEM,
  agentAccountId: 'macro|deploy-agent@example.test',
  permission: 'edit',
  status: 'pending',
  revision: 3,
  updatedAt: '2026-01-02T00:00:00Z',
  access: {
    status: 'pending',
    useBasis: null,
    canUpdate: false,
    canSetTotp: false,
    permissionRevision: 1,
    pendingRequestId: AGENT_REQUEST,
  },
};
let concurrentReview = search.get('agentStale') === '1';
function approved(
  permission: 'view' | 'edit'
): PasswordAgentAccessRequestState {
  return {
    ...agentState,
    permission,
    status: 'approved',
    revision: agentState.revision + 1,
    access: {
      status: 'usable',
      useBasis: 'approved_grant',
      canUpdate: permission === 'edit',
      canSetTotp: false,
      permissionRevision: agentState.access.permissionRevision + 1,
      pendingRequestId: null,
    },
  };
}
let agentListCalls = 0;
const agentRequests: AgentRequestSource = {
  async forItem(itemId) {
    agentListCalls++;
    if (
      (search.has('agentListFailure') && agentListCalls === 1) ||
      (search.has('agentRefreshFailure') && agentListCalls === 2)
    )
      return err('failed');
    return ok(itemId === AGENT_ITEM ? [agentState] : []);
  },
  async resolve(itemId, requestId, decision) {
    if (concurrentReview) {
      concurrentReview = false;
      agentState = approved('view');
    }
    if (
      itemId !== AGENT_ITEM ||
      requestId !== agentState.requestId ||
      agentState.status !== 'pending' ||
      decision.revision !== agentState.revision
    )
      return err('stale');
    agentState =
      decision.decision === 'approve'
        ? approved(decision.permission)
        : {
            ...agentState,
            status: 'denied',
            revision: agentState.revision + 1,
            access: {
              ...agentState.access,
              status: 'request_access',
              pendingRequestId: null,
            },
          };
    return ok(agentState);
  },
  async revoke(itemId, _agent, body) {
    if (
      itemId !== AGENT_ITEM ||
      body.expectedPermissionRevision !== agentState.access.permissionRevision
    )
      return err('stale');
    const removesGrant = body.scope === 'grant_and_approval';
    agentState = {
      ...agentState,
      status: removesGrant ? 'revoked' : agentState.status,
      access: {
        status: removesGrant ? 'request_access' : 'pending',
        useBasis: null,
        canUpdate: false,
        canSetTotp: false,
        permissionRevision: agentState.access.permissionRevision + 1,
        pendingRequestId: null,
      },
    };
    return ok(agentState.access);
  },
};
// The notification's split params, as the Passwords route receives them.
const focus = focusFromParams(
  search.has('focus')
    ? {
        teamId: search.get('focusTeam') ?? 'fixture-team',
        itemId: search.get('focus'),
      }
    : undefined,
  'fixture-team',
  1
);

// The first create of this folder name fails, as an unreachable vault would;
// the retry then succeeds.
const UNREACHABLE_FOLDER = 'Unreachable folder';
let folderCreateFailed = false;
let folderCreateAttempts = 0;
const createFolder = source.createFolder;
source.createFolder = async (name, parentId) => {
  if (name === UNREACHABLE_FOLDER) {
    folderCreateAttempts += 1;
    document.body.dataset.folderCreateAttempts = String(folderCreateAttempts);
  }
  if (name === UNREACHABLE_FOLDER && !folderCreateFailed) {
    folderCreateFailed = true;
    return err('failed');
  }
  return createFolder(name, parentId);
};
// Count metadata mutations so pointer tests can distinguish cancellation from a no-op tree.
let folderMoves = 0;
const moveFolder = source.moveFolder;
source.moveFolder = async (id, parentId) => {
  document.body.dataset.folderMoves = String(++folderMoves);
  return moveFolder(id, parentId);
};
let itemMoves = 0;
const moveItem = source.move;
source.move = async (item, folderId) => {
  document.body.dataset.itemMoves = String(++itemMoves);
  return moveItem(item, folderId);
};
const View = () => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <PasswordsProvider
      value={{
        scope: FIXTURE_SCOPE,
        source,
        recipients: () => [
          { id: 'fixture-person', name: 'Avery Lee', kind: 'user' },
          { id: 'fixture-team', name: 'Product team', kind: 'team' },
        ],
        recipientsLoading: () => false,
        recipientsError: () => false,
        writeClipboard: async (value) => {
          document.body.dataset.copied = value;
        },
        displayName: (accountId) => getDisplayName(tryMacroId(accountId)),
      }}
    >
      <ItemDndProvider>
        <div class="relative h-dvh bg-panel text-ink">
          <VaultView agentRequests={agentRequests} focus={focus} />
          <FloatRegionHost />
          <ToastRegion />
        </div>
      </ItemDndProvider>
    </PasswordsProvider>
  </QueryClientProvider>
);
render(() => <View />, root);
