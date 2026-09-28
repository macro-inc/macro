import type { IssueResult } from '@core/agent-session/AgentSession';
import type { PendingInteraction } from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  ElicitationAnswer,
  PermissionAnswer,
} from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';

export type InteractionIdentity = Pick<
  PendingInteraction,
  'kind' | 'requestId' | 'turn'
>;

export type InteractionResponse = InteractionIdentity &
  (
    | { kind: 'permission'; answer: PermissionAnswer }
    | { kind: 'elicitation'; answer: ElicitationAnswer }
  );

export type InteractionSource = {
  sessionId: Accessor<string | undefined>;
  pending: Accessor<readonly PendingInteraction[]>;
  canEdit: Accessor<boolean | undefined>;
  issue: (action: AgentAction) => Promise<IssueResult> | undefined;
  onFailure: (message: string) => void;
};

export type InteractionController = {
  pending: Accessor<readonly PendingInteraction[]>;
  canAnswer: Accessor<boolean>;
  answering: (request: InteractionIdentity) => boolean;
  respond: (response: InteractionResponse) => Promise<boolean>;
};
