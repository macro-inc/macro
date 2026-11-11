import type {
  CreateCalendarEvent_Deserialize,
  ReviewDecision_Deserialize,
  ReviewDraft_Deserialize,
  ReviewDrafts_Deserialize,
  ReviewRecord_Serialize,
  ReviewTitle,
  SendEmail,
} from '../../../generated/agent-reviews';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { AgentSession } from './agent-session';
import type { CodeExecution } from './code-execution';

type ReviewRecord = ReviewRecord_Serialize;
type ReviewDecision = ReviewDecision_Deserialize;

// The HTTP schemas are opaque: the server serializes the Rust review types,
// whose TypeScript contract is generated from the same Rust types.
function typedRecord(record: unknown): ReviewRecord {
  return record as ReviewRecord;
}

/** A persistent review remains actionable after the code execution ends. */
export class SessionReview extends MacroEntity<ReviewRecord> {
  private constructor(
    client: MacroClient,
    private readonly parent: AgentSession,
    id: string,
    seed?: ReviewRecord,
  ) {
    super(client, id, seed);
  }
  static byId(
    client: MacroClient,
    session: AgentSession,
    id: string,
  ): SessionReview {
    return new SessionReview(client, session, id);
  }
  static fromRecord(
    client: MacroClient,
    session: AgentSession,
    record: ReviewRecord,
  ): SessionReview {
    return new SessionReview(client, session, record.id, record);
  }
  static async create(
    client: MacroClient,
    execution: CodeExecution,
    input: CreateReviewOptions,
  ): Promise<SessionReview> {
    return SessionReview.createForSession(
      client,
      execution.session(),
      input,
      execution,
    );
  }
  /** Present a review in a session without requiring a code execution. */
  static async createForSession(
    client: MacroClient,
    session: AgentSession,
    input: CreateReviewOptions,
    execution?: CodeExecution,
  ): Promise<SessionReview> {
    const record = unwrap(
      await client.agentHarness.createSessionReview({
        path: { session_id: session.id },
        body: { ...input, executionId: execution?.id ?? null },
      }),
    );
    return SessionReview.fromRecord(client, session, typedRecord(record));
  }
  static async list(
    client: MacroClient,
    execution: CodeExecution,
  ): Promise<SessionReview[]> {
    const records = unwrap(
      await client.agentHarness.listExecutionReviews({
        path: {
          session_id: execution.session().id,
          execution_id: execution.id,
        },
      }),
    );
    return records.map((record) =>
      SessionReview.fromRecord(
        client,
        execution.session(),
        typedRecord(record),
      ),
    );
  }
  protected async fetch(): Promise<ReviewRecord> {
    return typedRecord(
      unwrap(
        await this.client.agentHarness.getSessionReview({
          path: { session_id: this.parent.id, review_id: this.id },
        }),
      ),
    );
  }
  readonly title = this.field('title');
  readonly kind = this.field('kind');
  /**
   * The session this review belongs to.
   *
   * @readonly
   */
  session(): AgentSession {
    return this.parent;
  }
  /**
   * Compact reference for main()'s returned reviews array.
   *
   * @readonly
   */
  async reference(): Promise<{ kind: ReviewRecord['kind']; id: string }> {
    return { kind: await this.kind(), id: this.id };
  }
  /**
   * The review's items, each with its draft, status and result.
   *
   * @readonly
   */
  async items(): Promise<ReviewItem[]> {
    const record = await this.detail.get();
    const items: ReviewRecord['items'] = record.items;
    return items.map(
      (item) =>
        new ReviewItem(item, {
          edit: (draft) =>
            this.decide({ action: 'edit', item: item.id, draft }),
          submit: () => this.decide({ action: 'submit', items: [item.id] }),
          dismiss: () => this.decide({ action: 'dismiss', items: [item.id] }),
        }),
    );
  }
  /**
   * Reload the saved review, for example after a decision or a conflict.
   *
   * @readonly
   */
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }
  /**
   * Submit the saved pending drafts. Never retries a conflict or ambiguous send.
   *
   * @destructive
   * @openworld
   */
  async submitAll(): Promise<void> {
    await this.decide({ action: 'submit', items: [] });
  }
  /**
   * Dismiss every pending draft without sending it.
   *
   * @destructive
   * @idempotent
   */
  async dismissAll(): Promise<void> {
    await this.decide({ action: 'dismiss', items: [] });
  }
  /** @internal Handles attach the cached revision; callers must refresh after a conflict. */
  private async decide(
    decision:
      | Omit<Extract<ReviewDecision, { action: 'edit' }>, 'revision'>
      | Omit<
          Extract<ReviewDecision, { action: 'submit' | 'dismiss' }>,
          'revision'
        >,
  ): Promise<void> {
    const revision = (await this.detail.get()).revision;
    await this.mutate((client) =>
      client.agentHarness.decideSessionReview({
        path: { session_id: this.parent.id, review_id: this.id },
        body: { ...decision, revision },
      }),
    );
  }
}

/**
 * An item handle scopes edits and decisions to its persisted review.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class ReviewItem {
  constructor(
    private readonly snapshot: ReviewRecord['items'][number],
    private readonly actions: {
      edit: (draft: ReviewDraft) => Promise<void>;
      submit: () => Promise<void>;
      dismiss: () => Promise<void>;
    },
  ) {}
  get id(): string {
    return this.snapshot.id;
  }
  get status(): ReviewRecord['items'][number]['status'] {
    return this.snapshot.status;
  }
  get draft(): ReviewRecord['items'][number]['draft'] {
    return this.snapshot.draft;
  }
  /** The action's confirmed response, `null` until it completes. */
  get result(): ReviewRecord['items'][number]['result'] {
    return this.snapshot.result;
  }
  /**
   * Replace this pending draft; `kind` must match the review's.
   *
   * @write
   * @idempotent
   */
  async edit(draft: ReviewDraft): Promise<void> {
    await this.actions.edit(draft);
  }
  /**
   * Submit this pending draft, sending the email or creating the event it holds.
   *
   * @destructive
   * @openworld
   */
  async submit(): Promise<void> {
    await this.actions.submit();
  }
  /**
   * Dismiss this pending draft without sending it.
   *
   * @destructive
   * @idempotent
   */
  async dismiss(): Promise<void> {
    await this.actions.dismiss();
  }
}

/** A replacement draft keyed by its review's kind. */
export type ReviewDraft = ReviewDraft_Deserialize;
/** Markdown is rendered by the ordinary email action; the UI can edit each draft. */
export type ReviewEmailDraft = SendEmail;
/** Calendar drafts use the existing calendar composer and creation action. */
export type ReviewCalendarDraft = CreateCalendarEvent_Deserialize;
/** A review's kind and its drafts; the execution is attached by the handle. */
export type CreateReviewOptions = {
  title: ReviewTitle;
} & ReviewDrafts_Deserialize;
