import type { PaidPlanTier } from '@app/features/paywall/plans';
import { createSignal } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import type {
  InviteOffer,
  Loadable,
  OnboardingContext,
  OnboardingRecord,
  Team,
  TeamInvite,
  Tool,
  ViewerState,
} from '../context/onboarding-context';
import type { EmailAccount } from '../core/email-accounts';

/** Everything the fake backend knows. Plain JSON, so a harness can persist it. */
export type FakeOnboardingWorld = {
  viewer: {
    id: string;
    email: string;
    tutorialComplete: boolean;
    licensed: boolean;
  } | null;
  emailAccounts: EmailAccount[];
  /** Addresses the next inbox connects link, in order. */
  inboxesToConnect: string[];
  record: OnboardingRecord;
  teams: Team[];
  invites: TeamInvite[];
  contacts: string[];
  catalog: Tool[];
  connectedTools: string[];
  githubStars: number | undefined;
  inviteOffer: InviteOffer | null;
  /** License refreshes left before the Stripe webhook lands; undefined when none is pending. */
  webhookPollsRemaining: number | undefined;
  /** How many refreshes a checkout's webhook takes to land. */
  webhookDelayPolls: number;
  accent: string | undefined;
  /** Capabilities that fail, with the message they report. */
  failures: Partial<
    Record<
      | 'emailAccounts'
      | 'teams'
      | 'catalog'
      | 'createTeam'
      | 'joinTeam'
      | 'checkout'
      | 'completion',
      string
    >
  >;
};

export type FakeEvent = { event: string; data: unknown };

export const FAKE_VIEWER_ID = 'macro|ada@acme.com';

export function defaultFakeWorld(): FakeOnboardingWorld {
  return {
    viewer: {
      id: FAKE_VIEWER_ID,
      email: 'ada@acme.com',
      tutorialComplete: false,
      licensed: false,
    },
    emailAccounts: [],
    inboxesToConnect: ['ada@acme.com', 'ada.personal@gmail.com'],
    record: { status: 'active', suggestedTeamDomain: 'acme.com' },
    teams: [],
    invites: [],
    contacts: ['grace@acme.com', 'alan@acme.com', 'friend@gmail.com'],
    catalog: ['Linear', 'Notion', 'GitHub', 'Slack', 'Figma', 'HubSpot'].map(
      (name) => ({ slug: name.toLowerCase(), name, iconUrl: null })
    ),
    connectedTools: [],
    githubStars: 12_345,
    inviteOffer: null,
    webhookPollsRemaining: undefined,
    webhookDelayPolls: 1,
    accent: undefined,
    failures: {},
  };
}

/**
 * An in-memory onboarding backend behind the real contract. `onChange` lets a
 * harness persist the world; `roundTrip` models the inbox OAuth redirect by
 * applying the change and then, say, reloading.
 */
export function createFakeOnboarding(
  overrides: Partial<FakeOnboardingWorld> = {},
  options: {
    onChange?: (world: FakeOnboardingWorld) => void;
    roundTrip?: (apply: () => void) => Promise<void>;
    checkoutUrl?: (tier: PaidPlanTier) => string;
    /** Report the sources as loading this long, like a cold page load. */
    latencyMs?: number;
    /** The viewer's own delay; a host that just resolved sign-in already has it. */
    viewerLatencyMs?: number;
  } = {}
) {
  const [world, setWorld] = createStore<FakeOnboardingWorld>({
    ...defaultFakeWorld(),
    ...overrides,
  });
  const [events, setEvents] = createSignal<FakeEvent[]>([]);
  const [notifications, setNotifications] = createSignal<string[]>([]);
  const [calls, setCalls] = createSignal<string[]>([]);

  const update = (change: (draft: FakeOnboardingWorld) => void) => {
    setWorld(produce(change));
    options.onChange?.(structuredClone(unwrap(world)));
  };
  const call = (name: string) => setCalls((list) => [...list, name]);
  const roundTrip = options.roundTrip ?? (async (apply) => apply());
  const fail = (key: keyof FakeOnboardingWorld['failures']) => {
    const message = world.failures[key];
    if (message === undefined) return;
    throw new Error(message);
  };
  const [settled, setSettled] = createSignal(!options.latencyMs);
  if (options.latencyMs) setTimeout(() => setSettled(true), options.latencyMs);
  const loadable = <T>(
    failure: keyof FakeOnboardingWorld['failures'],
    value: () => T
  ): Loadable<T> =>
    !settled()
      ? { t: 'loading' }
      : world.failures[failure] !== undefined
        ? { t: 'error' }
        : { t: 'ready', value: value() };

  const [viewerSettled, setViewerSettled] = createSignal(
    !options.viewerLatencyMs
  );
  if (options.viewerLatencyMs)
    setTimeout(() => setViewerSettled(true), options.viewerLatencyMs);
  const viewerState = (): ViewerState =>
    !viewerSettled()
      ? { t: 'loading' }
      : world.viewer
        ? { t: 'signed-in', viewer: { ...world.viewer } }
        : { t: 'signed-out' };

  const context: OnboardingContext = {
    viewer: viewerState,
    refreshViewer: async () => {
      call('refreshViewer');
      const remaining = world.webhookPollsRemaining;
      if (remaining !== undefined)
        update((draft) => {
          draft.webhookPollsRemaining =
            remaining > 1 ? remaining - 1 : undefined;
          if (remaining <= 1 && draft.viewer) draft.viewer.licensed = true;
        });
      return viewerState();
    },
    createOnboardingRecord: () => () =>
      settled() ? { t: 'ready', value: world.record } : { t: 'loading' },
    createEmailAccounts: () => ({
      accounts: () => loadable('emailAccounts', () => world.emailAccounts),
      refresh: async () => {},
    }),
    connectInbox: () => {
      call('connectInbox');
      return roundTrip(() =>
        update((draft) => {
          const address = draft.inboxesToConnect.shift();
          if (!address) return;
          draft.emailAccounts.push({
            address,
            isPrimary: draft.emailAccounts.length === 0,
            ownerId: draft.viewer?.id ?? FAKE_VIEWER_ID,
          });
        })
      );
    },
    createToolCatalog: () => {
      const [search, setSearch] = createSignal('');
      return {
        search,
        setSearch,
        entries: () =>
          world.failures.catalog !== undefined
            ? []
            : world.catalog.filter((tool) =>
                tool.name.toLowerCase().includes(search().trim().toLowerCase())
              ),
        fetching: () => false,
        failed: () => world.failures.catalog !== undefined,
        hasMore: () => false,
        loadMore: () => {},
        retry: () => call('retryCatalog'),
      };
    },
    createConnectedTools: () => () => new Set(world.connectedTools),
    // Pipedream's hosted connect runs in an iframe, so no page round-trip.
    connectTool: async (tool) => {
      call(`connectTool:${tool.slug}`);
      update((draft) => {
        draft.connectedTools.push(tool.slug);
      });
    },
    createTeamDirectory: () => ({
      teams: () => loadable('teams', () => world.teams),
      invites: () => loadable('teams', () => world.invites),
      contacts: () => ({ t: 'ready', value: world.contacts }),
      retry: () => call('retryTeams'),
    }),
    createTeam: async ({ name, invites }) => {
      call(`createTeam:${name}:${invites.join(',')}`);
      fail('createTeam');
      update((draft) => {
        draft.teams = [{ name }];
      });
    },
    joinTeam: async (inviteId) => {
      call(`joinTeam:${inviteId}`);
      fail('joinTeam');
      update((draft) => {
        const invite = draft.invites.find((item) => item.id === inviteId);
        draft.invites = draft.invites.filter((item) => item.id !== inviteId);
        if (invite) draft.teams = [{ name: `${invite.invitedBy}'s team` }];
      });
    },
    createInviteOffer: () => () => ({ t: 'ready', value: world.inviteOffer }),
    startCheckout: async (tier, terms) => {
      call(`startCheckout:${tier}:${terms}`);
      fail('checkout');
      update((draft) => {
        draft.webhookPollsRemaining = draft.webhookDelayPolls;
      });
      return (
        options.checkoutUrl?.(tier) ?? `https://checkout.stripe.test/${tier}`
      );
    },
    completeOnboarding: async ({ skipped }) => {
      call(skipped ? 'completeOnboarding:skipped' : 'completeOnboarding');
      if (world.failures.completion !== undefined) return { t: 'failed' };
      update((draft) => {
        draft.record.status = 'completed';
        if (draft.viewer) draft.viewer.tutorialComplete = true;
      });
      return { t: 'completed' };
    },
    repairTutorial: async () => {
      call('repairTutorial');
      update((draft) => {
        if (draft.viewer) draft.viewer.tutorialComplete = true;
      });
    },
    applyAccent: (color) => {
      call(`applyAccent:${color}`);
      update((draft) => {
        draft.accent = color;
      });
    },
    createGithubStars: () => () => world.githubStars,
    track: (event, data) => setEvents((list) => [...list, { event, data }]),
    notifyFailure: (message) => setNotifications((list) => [...list, message]),
  };

  return {
    context,
    world,
    update,
    events,
    notifications,
    calls,
  };
}
