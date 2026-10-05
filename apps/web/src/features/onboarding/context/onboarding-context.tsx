import type { PaidPlanTier } from '@app/features/paywall/plans';
import type { AppEvents } from '@app/lib/analytics/app-events';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { EmailAccount } from '../core/email-accounts';

/** Data availability as a source reports it; primitives decide presentation. */
export type Loadable<T> =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'ready'; value: T };

/** The signed-in account onboarding is setting up. */
export type Viewer = {
  id: string;
  email: string | undefined;
  tutorialComplete: boolean;
  /** An active or trialing paid license. */
  licensed: boolean;
};

export type ViewerState =
  | { t: 'loading' }
  | { t: 'signed-out' }
  | { t: 'signed-in'; viewer: Viewer };

/** The server's onboarding record. */
export type OnboardingRecord = {
  status: 'active' | 'completed';
  /** A domain the server would let this user claim a team for. */
  suggestedTeamDomain: string | undefined;
};

export type EmailAccountsSource = {
  accounts: Accessor<Loadable<readonly EmailAccount[]>>;
  /** Re-reads the links; resolves once the request settles. */
  refresh(): Promise<void>;
};

/** A connectable integration from the catalog. */
export type Tool = { slug: string; name: string; iconUrl: string | null };

type ToolCatalogSource = {
  /** What the user typed; the catalog re-queries once typing settles. */
  search: Accessor<string>;
  setSearch(value: string): void;
  entries: Accessor<readonly Tool[]>;
  fetching: Accessor<boolean>;
  failed: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  loadMore(): void;
  retry(): void;
};

export type Team = { name: string };
export type TeamInvite = { id: string; invitedBy: string };

export type TeamDirectorySource = {
  teams: Accessor<Loadable<readonly Team[]>>;
  invites: Accessor<Loadable<readonly TeamInvite[]>>;
  /** Contact email addresses, for same-domain invite suggestions. */
  contacts: Accessor<Loadable<readonly string[]>>;
  retry(): void;
};

export type CompletionResult = { t: 'completed' } | { t: 'failed' };

type OnboardingEventName =
  | Extract<keyof AppEvents, `onboarding_v4_${string}`>
  | 'subscription_success';
// The conditional mirrors the app's analytics signature so it can be passed through.
type TrackOnboarding = <E extends OnboardingEventName>(
  event: E,
  data: E extends keyof AppEvents ? AppEvents[E] : never
) => void;

/**
 * Everything onboarding needs from the app. Source factories run under the
 * consuming owner, so nothing is fetched until a step asks for it.
 */
export type OnboardingContext = {
  viewer: Accessor<ViewerState>;
  /** Re-reads the viewer from the server, e.g. while a webhook settles. */
  refreshViewer(): Promise<ViewerState>;
  createOnboardingRecord(): Accessor<Loadable<OnboardingRecord>>;
  createEmailAccounts(): EmailAccountsSource;
  /** Starts Google consent for another inbox; on web the page navigates away. */
  connectInbox(): Promise<void>;
  createToolCatalog(): ToolCatalogSource;
  /** Slugs of connected tools; undefined until known. */
  createConnectedTools(): Accessor<ReadonlySet<string> | undefined>;
  /** Resolves when the hosted connect flow closes; reports its own failures. */
  connectTool(tool: Tool): Promise<void>;
  createTeamDirectory(): TeamDirectorySource;
  /** Rejects on failure; the capability reports its own errors. */
  createTeam(input: { name: string; invites: string[] }): Promise<void>;
  /** Rejects on failure; the capability reports its own errors. */
  joinTeam(inviteId: string): Promise<void>;
  /** The hosted checkout URL; rejects with a message fit to show. */
  startCheckout(tier: PaidPlanTier): Promise<string>;
  /**
   * Marks onboarding and the tutorial done and confirms the server agrees.
   * `skipped` records that the user left without going through the steps.
   */
  completeOnboarding(options: { skipped: boolean }): Promise<CompletionResult>;
  /** Finishes a tutorial flag left behind by a completed onboarding record. */
  repairTutorial(): Promise<void>;
  applyAccent(color: string, viewerId: string): void;
  createGithubStars(): Accessor<number | undefined>;
  track: TrackOnboarding;
  notifyFailure(message: string): void;
};

const Context = createContext<OnboardingContext>();

export const OnboardingProvider = Context.Provider;

export function useOnboardingContext(): OnboardingContext {
  const context = useContext(Context);
  if (!context) throw new Error('OnboardingProvider is required');
  return context;
}
