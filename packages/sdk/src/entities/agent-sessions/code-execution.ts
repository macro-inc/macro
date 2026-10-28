import type { ExecutionRecord } from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { AgentSession } from './agent-session';
import { type CreateReviewOptions, SessionReview } from './review';

/** A saved code execution belonging to one agent session. */
export class CodeExecution extends MacroEntity<ExecutionRecord> {
  private constructor(
    client: MacroClient,
    id: string,
    private readonly parent: AgentSession,
  ) {
    super(client, id);
  }

  /** Construct a lazy execution handle within its owning session. */
  static byId(
    client: MacroClient,
    session: AgentSession,
    id: string,
  ): CodeExecution {
    return new CodeExecution(client, id, session);
  }

  protected async fetch(): Promise<ExecutionRecord> {
    return unwrap(
      await this.client.agentHarness.getCodeExecution({
        path: { session_id: this.parent.id, execution_id: this.id },
      }),
    );
  }

  /** Persistent UI blocks, independent of the execution lifetime. */
  readonly reviews = {
    create: (input: CreateReviewOptions) =>
      SessionReview.create(this.client, this, input),
    list: () => SessionReview.list(this.client, this),
  };

  /** The session this execution belongs to. */
  session(): AgentSession {
    return this.parent;
  }

  /** Saved execution state. Call refresh to observe subsequent changes. */
  readonly status = this.field('status');

  /** The submitted JavaScript module source. */
  readonly source = this.field('source');

  /** Legacy bridge calls; direct HTTP executions leave this empty. */
  readonly calls = this.field('calls');

  /** Execution failure text, when present. */
  readonly error = this.field('error');

  /** The program's returned JSON; preserves an explicit null result. */
  async result(): Promise<unknown> {
    return (await this.detail.get()).result;
  }

  /** Reload the saved state, for example after a running execution completes. */
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }
}

/** JSON data returned to the model, plus references to independently saved UI. */
export type CodeResult = {
  data: JsonValue;
  reviews: Array<{ kind: 'email' | 'calendar'; id: string }>;
};
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
