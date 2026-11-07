import type { TeamAgentComputer } from '@service-auth/generated/schemas';
import type { Harness } from '@service-storage/generated/schemas/harness';
import type { Accessor } from 'solid-js';
import { createSignal } from 'solid-js';

const params = new URLSearchParams(location.search);
export const [connections, setConnections] = createSignal<string[]>([]);
export const [dmRequests, setDmRequests] = createSignal(0);
export const harnessId = '11111111-1111-4111-8111-111111111111';
const [access, setAccess] = createSignal<Harness['access']>(
  params.has('no-access') ? 'none' : params.has('edit') ? 'user' : 'read'
);
window.addEventListener('fixture:revoke-control', () => setAccess('read'));
const runtime = (): Harness => ({
  id: harnessId,
  name: 'Agent computer',
  access: access(),
  capabilities: { screen: !params.has('no-screen') },
  computer_id: 'computer-1',
  is_agent_computer: true,
  kind: 'macrod',
  connected: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  created_by: 'agent-1',
  owner: { type: 'user', user_id: 'macro|agent@example.com' },
});
const computer = (): TeamAgentComputer => ({
  computerId: 'computer-1',
  harnessId: params.has('unpaired') ? null : harnessId,
  isAgentComputer: true,
});
export const useFeatureFlag = (flag: { key: string }) => () => ({
  enabled: flag.key === 'enable-macro-computers' ? !params.has('off') : true,
  loading: false,
});
export const tryMacroId = (value: string) =>
  value.startsWith('macro|') ? value : undefined;
export const isAgentAccount = (value?: string) =>
  !params.has('human') && value === 'macro|agent@example.com';
export const macroIdToEmail = (value: string) => value.replace(/^macro\|/, '');
export const getDisplayName = () => 'Assistant';
export const getDisplayNameParts = () => ({
  firstName: 'Assistant',
  lastName: '',
});
export const getInitials = () => 'A';
export const useIsConnectedSecondaryInbox = () => () => false;
export const useProfilePictureUrl = () => [() => undefined];
export const useOpenDirectMessage = () => async () => {
  setDmRequests((count) => count + 1);
};
export const useSettingsState = () => ({ openSettings: () => {} });
export const useUserCardActions = () => () => [];
export const UserRuntimes = () => null;
export const AgentRuntime = () => null;
export function useHarnessDirectoryQuery(
  enabled: Accessor<boolean> = () => true
) {
  return {
    isPending: false,
    isError: false,
    get data() {
      return enabled() ? [runtime()] : undefined;
    },
    refetch: async () => ({ data: [runtime()] }),
  };
}
export function useTeamAgentComputerQuery(
  _id: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return {
    isPending: false,
    get data() {
      return enabled() ? computer() : undefined;
    },
  };
}
export const useTeamAgentComputerMutation = () => ({
  mutateAsync: async () => computer(),
});
export const useAgentsQuery = () => ({
  isPending: false,
  data: params.has('bot')
    ? [{ bot: { id: 'custom-agent' }, harness_id: harnessId }]
    : [],
});
export const accessRequestsClient = {};
export const fetchAccessRequestState = async () => ({
  mine: null,
  incoming: [],
});
export const refreshSharedAccess = () => {};
export function useAccessRequestState() {
  return {
    isPending: false,
    isFetching: false,
    isPaused: false,
    isFetchedAfterMount: true,
    isError: false,
    data: {
      accessLevel: null,
      canReview: false,
      supportedLevels: ['view'],
      mine: null,
      requests: [],
      pendingCount: 0,
    },
  };
}
export async function invalidateAccessRequests() {}

export const useUserId = () => () => 'macro|viewer@example.com';
export const useChannel = () => () => ({
  agent_dm: params.has('bot') ? { bot_id: 'custom-agent' } : undefined,
  channel_type: params.has('channel') ? 'private' : 'direct_message',
  participants: [
    { user_id: 'macro|viewer@example.com' },
    { user_id: 'macro|agent@example.com' },
    ...(params.has('group') ? [{ user_id: 'macro|person@example.com' }] : []),
  ],
});
// Preserve unrelated context exports; only the fixture viewer identity is replaced.
export * from '../../../../lib/core/context/user';
