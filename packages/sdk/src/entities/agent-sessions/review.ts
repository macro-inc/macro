import type {
  ReviewDecision,
  ReviewRecord,
} from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { AgentSession } from './agent-session';
import type { CodeExecution } from './code-execution';

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
    return SessionReview.fromRecord(client, session, record);
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
      SessionReview.fromRecord(client, execution.session(), record),
    );
  }
  protected async fetch(): Promise<ReviewRecord> {
    return unwrap(
      await this.client.agentHarness.getSessionReview({
        path: { session_id: this.parent.id, review_id: this.id },
      }),
    );
  }
  readonly title = this.field('title');
  readonly kind = this.field('kind');
  session(): AgentSession {
    return this.parent;
  }
  /** Compact reference for main()'s returned reviews array. */
  async reference(): Promise<{ kind: ReviewRecord['kind']; id: string }> {
    return { kind: await this.kind(), id: this.id };
  }
  async items(): Promise<ReviewItem[]> {
    return (await this.detail.get()).items.map(
      (item) =>
        new ReviewItem(item, {
          edit: (draft) =>
            this.decide({ action: 'edit', item: item.id, draft }),
          submit: () => this.decide({ action: 'submit', items: [item.id] }),
          dismiss: () => this.decide({ action: 'dismiss', items: [item.id] }),
        }),
    );
  }
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }
  /** Submit the saved pending drafts. Never retries a conflict or ambiguous send. */
  async submitAll(): Promise<void> {
    await this.decide({ action: 'submit', items: [] });
  }
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

/** An item handle scopes edits and decisions to its persisted review. */
export class ReviewItem {
  constructor(
    private readonly snapshot: ReviewRecord['items'][number],
    private readonly actions: {
      edit: (draft: unknown) => Promise<void>;
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
  get draft(): unknown {
    return this.snapshot.draft;
  }
  get result(): unknown {
    return this.snapshot.result;
  }
  async edit(draft: unknown): Promise<void> {
    await this.actions.edit(draft);
  }
  async submit(): Promise<void> {
    await this.actions.submit();
  }
  async dismiss(): Promise<void> {
    await this.actions.dismiss();
  }
}

/** Markdown is rendered by the ordinary email action; the UI can edit each draft. */
export type ReviewEmailDraft = {
  subject: string;
  body: string;
  to: Array<{ email: string; name?: string | null }>;
  cc?: Array<{ email: string; name?: string | null }>;
  bcc?: Array<{ email: string; name?: string | null }>;
  replyingToId?: string | null;
  includeSignature?: boolean | null;
  attachments?: Array<{ documentId: string }>;
};
export type CreateReviewOptions =
  | { kind: 'email'; title: string; drafts: ReviewEmailDraft[] }
  | { kind: 'calendar'; title: string; drafts: ReviewCalendarDraft[] };
/** Calendar drafts use the existing calendar composer and creation action. */
export type ReviewCalendarDraft = {
  title: string;
  time: import('../../../generated/calendar/types.gen').EventTime;
  description?: string | null;
  location?: string | null;
  attendees?: Array<{ email: string; isOptional?: boolean }>;
  calendarId?: string | null;
  recurrenceLines?: string[];
  addMacroCall?: boolean;
  addGoogleMeet?: boolean;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  } | null;
  eventType?: 'default' | 'out_of_office';
  outOfOffice?: {
    autoDeclineMode?: 'decline_none' | 'decline_all' | 'decline_new_only';
    declineMessage?: string | null;
  } | null;
};
