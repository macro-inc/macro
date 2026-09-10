import type { QueuedActionDto } from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * One action waiting in an agent session's server-side queue: a prompt or a
 * compact accepted while a turn was running, dispatching when that turn
 * ends. Until then it can be edited (prompts only) or removed; once it has
 * dispatched, both answer 404 — there is no un-sending.
 *
 * List-sourced only - there is no per-action GET, only the queue snapshot -
 * so this wraps whatever DTO the caller already has, the same shape
 * `CrmComment` wraps a list-sourced record, rather than `MacroEntity`'s
 * lazy-fetch-by-id.
 */
export class QueuedAction {
  private constructor(
    private readonly client: MacroClient,
    private readonly sessionId: string,
    private dto: QueuedActionDto,
  ) {}

  /** Wrap a queue entry already in hand (e.g. from `AgentSession.queue()`). */
  static from(
    client: MacroClient,
    sessionId: string,
    dto: QueuedActionDto,
  ): QueuedAction {
    return new QueuedAction(client, sessionId, dto);
  }

  /**
   * The id the action was accepted under. Once it dispatches, this equals
   * `requestId` on the folded message the action derives.
   */
  get actionId(): string {
    return this.dto.actionId;
  }

  /** `prompt` or `compact`; only turn-occupying actions are ever queued. */
  get kind(): string {
    return this.dto.kind;
  }

  /** The prompt's raw text, present for prompts only. What an edit replaces. */
  get prompt(): string | undefined {
    return this.dto.prompt ?? undefined;
  }

  /** The user who queued it, absent when a bot acted on nobody's behalf. */
  get actorUserId(): string | undefined {
    return this.dto.actorUserId ?? undefined;
  }

  /** When the action was accepted, as an RFC 3339 timestamp. */
  get createdAt(): string {
    return this.dto.createdAt;
  }

  /**
   * Replace this queued prompt's text before it dispatches. Returns this
   * handle for chaining; the edit endpoint answers 204, so `prompt` is
   * applied locally rather than reread from a response body.
   */
  async edit(prompt: string): Promise<this> {
    unwrap(
      await this.client.agentHarness.editQueuedAction({
        path: { session_id: this.sessionId, action_id: this.actionId },
        body: { prompt },
      }),
    );
    this.dto = { ...this.dto, prompt };
    return this;
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
