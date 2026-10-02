import { createSignal } from 'solid-js';

const params = new URLSearchParams(location.search);
const [complete, setComplete] = createSignal(false);
const [connected, setConnected] = createSignal<
  { app_slug: string; server_name: string }[]
>([]);
const [team, setTeam] = createSignal<{ name: string }[]>([]);
const [events, setEvents] = createSignal<string[]>([]);
export const fixtureEvents = events;
const record = (event: string) => setEvents((items) => [...items, event]);
const user = () => ({
  authenticated: true,
  tutorialComplete: complete(),
  userId: 'onboarding-fixture',
  licenseStatus: params.has('subscriptionSuccess') ? 'trialing' : 'free',
});
const success = <T>(data: () => T) => ({
  get data() {
    return data();
  },
  isSuccess: true,
  isPending: false,
  isPlaceholderData: false,
  isError: false,
  refetch: async () => ({ data: data() }),
});
export const useUserInfoQuery = () => success(user);
export const useUserId = () => () => 'onboarding-fixture';
export const useEmail = () => () => 'designer@example.com';
export const useAnalytics = () => ({ track: (event: string) => record(event) });
export const useSearchParams = () => [Object.fromEntries(params)];
export const useNavigate = () => (path: string) =>
  record(`Navigated to ${path}`);
export const authKeys = { userInfo: { queryKey: ['fixture-user'] } };
export const queryClient = {
  refetchQueries: async () => {},
  getQueryData: user,
};
export const useCompleteTutorialMutation = () => ({
  mutateAsync: async () => setComplete(true),
});
export const useCompleteOnboardingMutation = () => ({
  mutateAsync: async () => record('Completed onboarding'),
});
export const useOnboardingQuery = () =>
  success(() => ({
    row: { status: 'active' },
    suggested_team_domain: undefined,
  }));
export const useImportQuery = () => success(() => ({}));
export const useEmailLinksQuery = () =>
  success(() => ({
    links: Array.from(
      { length: Number(params.get('accounts') ?? 0) },
      (_, i) => ({
        email_address: `${i ? 'personal' : 'work'}@example.com`,
        is_primary: i === 0,
        macro_id: 'onboarding-fixture',
      })
    ),
  }));
export const invalidateEmailLinks = async () => {};
export const useAddInboxFlow = () => async () => {
  const next = new URL(location.href);
  next.searchParams.set(
    'accounts',
    String(Number(params.get('accounts') ?? 0) + 1)
  );
  location.assign(next.href);
};
export const useMcpServersQuery = () => success(() => []);
export const usePipedreamConnectionsQuery = () => success(connected);
export const usePipedreamConnectedSlugs = () => ({
  slugs: () => new Set(connected().map((item) => item.app_slug)),
  ready: () => true,
});
const catalog = [
  'Linear',
  'Notion',
  'GitHub',
  'Slack',
  'Figma',
  'HubSpot',
  'Zoom',
  'Dropbox',
].map((name) => ({
  app_slug: name.toLowerCase(),
  display_name: name,
  description: name,
  icon_url: null,
}));
export const usePipedreamCatalogQuery = (search: () => string) =>
  Object.assign(
    success(() => ({
      pages: [
        {
          servers: catalog.filter((item) =>
            item.display_name.toLowerCase().includes(search().toLowerCase())
          ),
        },
      ],
    })),
    { isFetching: false, hasNextPage: false }
  );
export const connectPipedreamApp = async ({
  appSlug,
  serverName,
}: {
  appSlug: string;
  serverName: string;
}) => {
  setConnected((items) => [
    ...items,
    { app_slug: appSlug, server_name: serverName },
  ]);
  record(`Connected ${serverName}`);
  return 'connected';
};
export const useUserTeamsQuery = () => success(team);
export const useUserInvitesQuery = () => success(() => ({ invites: [] }));
export const useContacts = () => () => [];
export const useContactsQuery = () => success(() => []);
export const useJoinTeamMutation = () => ({
  isPending: false,
  mutate: () => {},
});
export const useCreateTeamWithInvitesMutation = () => ({
  isPending: false,
  mutateAsync: async ({ name }: { name: string }) => {
    setTeam([{ name }]);
    record('Created test team');
  },
});
export const useCreateCheckoutSessionMutation = () => ({
  mutateAsync: async () =>
    `${location.origin}/?subscriptionSuccess=true&type=premium`,
});
export const toast = { failure: record, success: record };
