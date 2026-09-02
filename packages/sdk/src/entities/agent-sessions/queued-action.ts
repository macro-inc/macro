import type { QueuedActionDto } from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * One action waiting in an agent session's server-side queue: a prompt or a
 * compact accepted while a turn was running, dispatching when that turn
 * ends. Until then it can be edited (prompts only) or removed; once it has
 * dispatched, both answer 404 — there is no un-sending.
 */
export class QueuedAction {
  /**
   * The id the action was accepted under. Once it dispatches, this equals
   * `requestId` on the folded message the action derives.
   */
  readonly actionId: string;

  /** `prompt` or `compact`; only turn-occupying actions are ever queued. */
  readonly kind: string;

  /** The prompt's raw text, present for prompts only. What an edit replaces. */
  readonly prompt: string | undefined;

  /** The user who queued it, absent when a bot acted on nobody's behalf. */
  readonly actorUserId: string | undefined;

  /** When the action was accepted, as an RFC 3339 timestamp. */
  readonly createdAt: string;

  /** @internal Minted by `AgentSession.queue()`. */
  constructor(
    private readonly client: MacroClient,
    private readonly sessionId: string,
    dto: QueuedActionDto,
  ) {
    this.actionId = dto.actionId;
    this.kind = dto.kind;
    this.prompt = dto.prompt ?? undefined;
    this.actorUserId = dto.actorUserId ?? undefined;
    this.createdAt = dto.createdAt;
  }

  /** Replace this queued prompt's text before it dispatches. */
  async edit(prompt: string): Promise<void> {
    unwrap(
      await this.client.agentHarness.editQueuedAction({
        path: { session_id: this.sessionId, action_id: this.actionId },
        body: { prompt },
      }),
    );
  }

  /** Remove this action from the queue before it dispatches. */
  async remove(): Promise<void> {
    unwrap(
      await this.client.agentHarness.removeQueuedAction({
        path: { session_id: this.sessionId, action_id: this.actionId },
      }),
    );
  }
}
