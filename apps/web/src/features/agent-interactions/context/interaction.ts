import type { IssueResult } from '@core/agent-session/AgentSession';
import type { PendingInteraction } from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  ElicitationAnswer,
  PermissionAnswer,
} from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';
import type { FormValues } from '../state/elicitation-form';

/** Requests the agent itself asked, answered through agent actions. */
export type AgentInteraction = Exclude<
  PendingInteraction,
  { kind: 'tool_approval' }
>;

export type InteractionIdentity = Pick<
  AgentInteraction,
  'kind' | 'requestId' | 'turn'
>;

export type InteractionResponse = InteractionIdentity &
  (
    | { kind: 'permission'; answer: PermissionAnswer }
    | { kind: 'elicitation'; answer: ElicitationAnswer }
  );

/** What the user has done so far with a request they have not answered. */
export type InteractionDraft = {
  /** A question's fields, as typed. */
  form?: FormValues;
  /** A drafted tool's arguments, as edited in its composer. */
  tool?: unknown;
};

/**
 * What a card keeps of the user's input, so it outlives the card: what was
 * kept when the card mounted, and where to keep more.
 */
export type DraftKeeper<T> = {
  saved: T | undefined;
  save: (draft: T) => void;
};

/** Who can answer a request, as a card names them to a viewer who cannot. */
export const DEFAULT_ANSWERERS = 'someone who can edit this agent';

export type InteractionSource = {
  sessionId: Accessor<string | undefined>;
  pending: Accessor<readonly PendingInteraction[]>;
  canEdit: Accessor<boolean | undefined>;
  issue: (action: AgentAction) => Promise<IssueResult> | undefined;
  onFailure: (message: string) => void;
  /** Who can answer, when not {@link DEFAULT_ANSWERERS}. */
  answerers?: string;
  /**
   * Whether the viewer owns the session: what the agent drafts - an email,
   * an event - goes out under the owner's name, from the owner's inbox and
   * calendar.
   */
  owns?: Accessor<boolean | undefined>;
};

export type InteractionController = {
  pending: Accessor<readonly PendingInteraction[]>;
  canAnswer: Accessor<boolean>;
  /** Who can answer: `someone who can edit this session`. */
  answerers: string;
  /** The viewer owns the session, so its drafts go out under their name. */
  owns: Accessor<boolean>;
  answering: (request: InteractionIdentity) => boolean;
  respond: (response: InteractionResponse) => Promise<boolean>;
  /** What the user has typed into `request` so far, until it is answered. */
  draft: (request: InteractionIdentity) => InteractionDraft | undefined;
  /** Keep what the user has typed into `request`. */
  keepDraft: (request: InteractionIdentity, draft: InteractionDraft) => void;
};
