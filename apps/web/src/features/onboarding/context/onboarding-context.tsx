import type { PaidPlanTier } from '@app/features/paywall/plans';
import type { AppEvents } from '@app/lib/analytics/app-events';
import type { AiPlanCatalog } from '@service-auth/ai-billing-types';
import type { GtmInviteOffer } from '@service-auth/generated/schemas/gtmInviteOffer';
import type {
  RoutineSuggestion,
  RoutineSuggestions,
} from '@service-scheduled-action/generated/schemas';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { CheckoutTerms } from '../core/checkout';
import type { EmailAccount } from '../core/email-accounts';
import type {
  SuggestionEdits,
  SuggestionRow,
} from '../core/routine-suggestions';

/** Data availability as a source reports it; primitives decide presentation. */
export type Loadable<T> =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'ready'; value: T };

/** The signed-in account onboarding is setting up. */
export type Viewer = {
  id: string;
  email: string | undefined;
  /** The claimed first-party mailbox handle, absent until a legacy user claims it. */
  handle: string | undefined;
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

export type InboxProvider = 'google' | 'microsoft';

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

export type ToolConnectionState =
  | 'loading'
  | 'error'
  | 'available'
  | 'disabled'
  | 'connected'
  | 'account-linked';
export type ConnectedToolsSource = {
  connected: Accessor<ReadonlySet<string>>;
  state(slug: string): ToolConnectionState;
  retry(): void;
};

export type Team = { name: string };
export type TeamInvite = { id: string; invitedBy: string };

export type TeamDirectorySource = {
  teams: Accessor<Loadable<readonly Team[]>>;
  invites: Accessor<Loadable<readonly TeamInvite[]>>;
  /** At most PREFILL_CAP same-domain invite suggestions, not a contact catalog. */
  contacts: Accessor<Loadable<readonly string[]>>;
  retry(): void;
};

/** The promotion an invite link granted this account. */
export type InviteOffer = GtmInviteOffer;

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
  /** Claims the handle once and initializes its Rox mailbox link. */
  claimHandle(handle: string): Promise<void>;
  createOnboardingRecord(): Accessor<Loadable<OnboardingRecord>>;
  createEmailAccounts(): EmailAccountsSource;
  /**
   * Starts consent for another inbox; on web the page navigates away. Without
   * a provider the app asks which one.
   */
  connectInbox(provider?: InboxProvider): Promise<void>;
  /**
   * Whether to offer Outlook beside Google: Microsoft sign-up is on and this
   * user may connect an Outlook inbox. False until both are known.
   */
  createOutlookAvailability(): Accessor<boolean>;
  createToolCatalog(): ToolCatalogSource;
  /**
   * Independent provider states. `poll` re-checks while connections change.
   */
  createConnectedTools(options: { poll: boolean }): ConnectedToolsSource;
  /** GitHub uses native account OAuth; other tools use hosted connect. Reports its own failures. */
  connectTool(tool: Tool): Promise<void>;
  /** Opens the native GitHub App repository selection, after account linking. */
  configureGithubRepositories(): void;
  createTeamDirectory(input: {
    domain: Accessor<string | undefined>;
    ownEmail: Accessor<string | undefined>;
  }): TeamDirectorySource;
  /** Rejects on failure; the capability reports its own errors. */
  /** `allowDomainJoin` lets people on the owner's work domain join.
   * `notifyDomain` also emails the owner's same-domain contacts that the team
   * exists; the server sends it only to a team with an auto-join domain. */
  createTeam(input: {
    name: string;
    invites: string[];
    allowDomainJoin: boolean;
    notifyDomain: boolean;
  }): Promise<void>;
  /** Rejects on failure; the capability reports its own errors. */
  joinTeam(inviteId: string): Promise<void>;
  /**
   * Copies the viewer's team invite link, creating the link when the team has
   * none. Rejects on failure; the capability reports its own result.
   */
  copyTeamInviteLink(): Promise<void>;
  /**
   * Sends a referral invite to each address; no team is involved. Rejects
   * when none was sent; the capability reports its own result.
   */
  sendReferralInvites(emails: string[]): Promise<void>;
  /** Copies the viewer's referral sign-up link. Rejects on failure; the
   * capability reports its own result. */
  copyReferralLink(): Promise<void>;
  /** The invite promotion the account holds; null when it has none. */
  createInviteOffer(): Accessor<Loadable<InviteOffer | null>>;
  createTrialEligibility(): {
    eligibility: Accessor<Loadable<boolean>>;
    existingSubscription: Accessor<boolean>;
    managing: Accessor<boolean>;
    manage(): Promise<void>;
    retry(): void;
  };
  createPlanCatalog(): {
    catalog: Accessor<Loadable<AiPlanCatalog>>;
    retry(): void;
  };
  /** The hosted checkout URL; rejects with a message fit to show. */
  startCheckout(tier: PaidPlanTier, terms: CheckoutTerms): Promise<string>;
  /**
   * Marks onboarding and the tutorial done and confirms the server agrees.
   * `skipped` records that the user left without going through the steps.
   */
  completeOnboarding(options: { skipped: boolean }): Promise<CompletionResult>;
  /** Routine suggestions are on: the flow ends with the routines step. */
  routineSuggestionsEnabled: Accessor<boolean>;
  /**
   * Starts AI suggesting routines from the inbox just connected, in this
   * browser's time zone. The server runs it once per person.
   */
  generateRoutineSuggestions(): void;
  createRoutinesStep(): RoutinesStepSource;
  /** Finishes a tutorial flag left behind by a completed onboarding record. */
  repairTutorial(): Promise<void>;
  applyAccent(color: string, viewerId: string): void;
  createGithubStars(): Accessor<number | undefined>;
  track: TrackOnboarding;
  notifyFailure(message: string): void;
};

/** The last step's routine suggestions, and how to turn them on. */
export type RoutinesStepSource = {
  /** The scheduler's answer; undefined until first read. */
  answer: Accessor<RoutineSuggestions | undefined>;
  /** It couldn't be read, and nothing was read before. */
  failed: Accessor<boolean>;
  refresh(): Promise<unknown>;
  /** How a suggestion reads; undefined when it can't be built here. */
  row(suggestion: RoutineSuggestion): SuggestionRow | undefined;
  /**
   * Creates it, on, recorded as saved from its suggestion; resolves with the
   * routine's id and rejects on failure.
   */
  create(
    suggestion: RoutineSuggestion,
    edits: SuggestionEdits
  ): Promise<string>;
};

const Context = createContext<OnboardingContext>();

export const OnboardingProvider = Context.Provider;

export function useOnboardingContext(): OnboardingContext {
  const context = useContext(Context);
  if (!context) throw new Error('OnboardingProvider is required');
  return context;
}
