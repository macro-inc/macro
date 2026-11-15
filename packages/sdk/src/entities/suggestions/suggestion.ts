import type {
  Category,
  EntityAction,
  RunMode,
  RunStateName,
  Suggestion as SuggestionRecord,
  SuggestionState,
  SuggestionStatus,
  SuggestionWriteOutcome as SuggestionWriteRecord,
  Target,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { activityEntity } from '../activity/entity';
import { AgentSession } from '../agent-sessions/agent-session';
import { EmailDraft } from '../email/draft';
import type { MacroEntityType } from '../entity';
import type { EntityReference } from '../reference';

/** An item a suggestion is about: any handle with an entity type, such as an `EmailThread`, and optionally a part of it, such as one message in a channel. */
export interface SuggestionItem {
  readonly entity: {
    readonly id: string;
    readonly entityType: MacroEntityType;
  };
  readonly part?: { readonly id: string };
}

/** What became of a suggestions write: whether it was applied and, when not, the `problems` to fix before trying again. */
export interface SuggestionWriteOutcome {
  readonly ok: boolean;
  readonly problems: string[];
  /** The suggestion as it now is, when the write was applied. */
  readonly suggestion?: Suggestion;
}

/** Changes to an open suggestion; fields left out stay as they are. */
export interface SuggestionChanges {
  title?: string;
  summary?: string;
  importance?: number;
  categories?: Category[];
  about?: SuggestionItem[];
  /** Only on prompt suggestions. */
  prompt?: string;
  /** Only on background prompt suggestions: what the run posts or sends, and where. */
  sends?: string;
  /** Why, for the change log. */
  reason: string;
}

/** The wire form of a suggestion's items. */
export function targets(items: SuggestionItem[]): Target[] {
  return items.map((item) => ({
    entityType: item.entity.entityType,
    entityId: item.entity.id,
    partId: item.part?.id,
  }));
}

/** A suggestions write's outcome, with its suggestion as a handle. */
export function outcome(
  client: MacroClient,
  record: SuggestionWriteRecord,
): SuggestionWriteOutcome {
  return {
    ok: record.ok,
    problems: record.problems,
    suggestion: record.suggestion
      ? Suggestion.from(client, record.suggestion)
      : undefined,
  };
}

/**
 * One of the user's suggestions: a prompt to run, a note about specific items, or a
 * routine suggestion. List-sourced only, from `macro.suggestions.list()` or
 * `macro.suggestions.review()`, so this wraps the record the caller already has.
 *
 * @mcp-exclude Suggestions are written by hidden generation sessions and acted on in the app, not over MCP.
 */
export class Suggestion {
  private constructor(
    private readonly client: MacroClient,
    private readonly record: SuggestionRecord,
  ) {}

  /** Wrap a suggestion record already in hand. */
  static from(client: MacroClient, record: SuggestionRecord): Suggestion {
    return new Suggestion(client, record);
  }

  /** The suggestion's record, so a program can return a suggestion or a write's outcome. */
  toJSON(): SuggestionRecord {
    return this.record;
  }

  /** The suggestion's id. */
  get id(): string {
    return this.record.id;
  }

  /** `prompt`, `entity` or `routine`; never changes. */
  get kind(): SuggestionRecord['kind'] {
    return this.record.kind;
  }

  /** Names the suggestion across nights; suggesting the same key again updates this suggestion. */
  get dedupKey(): string {
    return this.record.dedupKey;
  }

  /** What to do, in a few words. */
  get title(): string {
    return this.record.title;
  }

  /** Why, in a line or two. */
  get summary(): string {
    return this.record.summary;
  }

  /** 0 to 100. */
  get importance(): number {
    return this.record.importance;
  }

  /** The feed's filters it shows under. */
  get categories(): Category[] {
    return this.record.categories;
  }

  /** Where it is for the user: `dismissed` ones were turned down by the user, `retired` ones by a session. */
  get state(): SuggestionState {
    return this.record.state;
  }

  /**
   * What its card shows: `open` to act on, `running` while its background run
   * is under way (or, restored after a dismissal, still being stopped),
   * `failed` when that run failed (the user can run it again from the app),
   * `done`, or `closed` (dismissed, resolved or retired; never in the feed).
   */
  get status(): SuggestionStatus {
    return this.record.status;
  }

  /** When its state last changed, such as when the user dismissed it, as RFC 3339. */
  get stateChangedAt(): string {
    return this.record.stateChangedAt;
  }

  /** The items it is about, as `{ entityType, entityId, partId }`. */
  get about(): Target[] {
    return this.record.about;
  }

  /** A prompt suggestion's prompt. */
  get prompt(): string | undefined {
    return this.record.kind === 'prompt' ? this.record.prompt : undefined;
  }

  /** A prompt suggestion's run mode. */
  get runMode(): RunMode | undefined {
    return this.record.kind === 'prompt' ? this.record.runMode : undefined;
  }

  /**
   * What a background prompt suggestion's run posts or sends, and where, as its
   * card shows it before Run; running the suggestion approves exactly that.
   * Undefined when the run posts and sends nothing.
   */
  get sends(): string | undefined {
    return this.record.kind === 'prompt'
      ? (this.record.sends ?? undefined)
      : undefined;
  }

  /**
   * A background prompt suggestion's latest run: its hidden agent `session`
   * (open it to see the result), when it started, its `state` as last
   * recorded (`starting`, `running`, `waiting`, `stopping` or `cancelling`
   * while under way; `finished`, `failed` or `cancelled` once settled), and
   * when it entered that state.
   */
  get run():
    | {
        session: AgentSession;
        startedAt: string;
        state: RunStateName;
        stateChangedAt: string;
      }
    | undefined {
    const run = this.record.run;
    return run
      ? {
          session: AgentSession.byId(this.client, run.sessionId),
          startedAt: run.startedAt,
          state: run.state,
          stateChangedAt: run.stateChangedAt,
        }
      : undefined;
  }

  /**
   * What came of it, as a handle, while its `status` is `done` or `failed`:
   * what its finished run made (else its agent session), its failed run's
   * session, or without a run what acting on it made, such as a saved
   * routine. Undefined otherwise, and for a kind of item the SDK has no
   * handle for.
   */
  get result(): EntityReference | undefined {
    const result = this.record.result;
    return result
      ? activityEntity(this.client, result.entityType, result.entityId)
      : undefined;
  }

  /** An entity suggestion's action. */
  get action(): EntityAction | undefined {
    return this.record.kind === 'entity' ? this.record.action : undefined;
  }

  /** When the message a reply suggestion answers came, as RFC 3339; undefined once the user replied, or when unknown. */
  get waitingSince(): string | undefined {
    return this.record.kind === 'entity'
      ? (this.record.waitingSince ?? undefined)
      : undefined;
  }

  /** Who sent the message a reply suggestion answers, by name; never an address. */
  get from(): string | undefined {
    return this.record.kind === 'entity'
      ? (this.record.from ?? undefined)
      : undefined;
  }

  /** A reply suggestion's draft, once a session attached one; it no longer loads once the user deleted it. */
  get draft(): EmailDraft | undefined {
    if (this.record.kind !== 'entity') return undefined;
    const partId = this.record.draft?.partId;
    return partId ? EmailDraft.byId(this.client, partId) : undefined;
  }

  /** The start of a reply suggestion's draft as plain text, as it was when attached, without loading the draft. */
  get draftPreview(): string | undefined {
    return this.record.kind === 'entity'
      ? (this.record.draft?.preview ?? undefined)
      : undefined;
  }

  /**
   * Mark this suggestion as taken up for the user. Only the user starts a
   * background prompt suggestion's run, from the app: accepting one here only
   * takes it on (`state` becomes `accepted`, no run), so tell the user it is
   * ready for them to run. A routine suggestion fails with 400: the user saves
   * its routine from the app. Any other suggestion becomes done, so do what it
   * suggests yourself. Fails with 409 when the suggestion changed since it was
   * read: read it again. For the user's own agent; a generation session
   * gets a 403.
   */
  async accept(): Promise<void> {
    unwrap(
      await this.client.scheduledAction.acceptSuggestion({
        path: { id: this.id },
        body: { updatedAt: this.record.updatedAt },
      }),
    );
  }

  /**
   * The user doesn't want this open suggestion; a routine suggestion's routine
   * suggestion is dismissed with it. For the user's own agent; a generation
   * session gets a 403.
   */
  async dismiss(): Promise<void> {
    unwrap(
      await this.client.scheduledAction.dismissSuggestion({
        path: { id: this.id },
      }),
    );
  }

  /**
   * Take back the user's dismissal of this suggestion: it is open again. Only
   * within five minutes of the dismissal, by the same user; fails with 409
   * later, and for a routine suggestion. A background run the dismissal
   * stopped stays stopped: the suggestion shows `running` until it has, then
   * the user runs it again from the app. For the user's own agent; a
   * generation session gets a 403.
   */
  async restore(): Promise<void> {
    unwrap(
      await this.client.scheduledAction.restoreSuggestion({
        path: { id: this.id },
      }),
    );
  }

  /**
   * Rewrite this open suggestion's title, summary, prompt, importance, categories
   * or items, with a `reason`. Only a suggestions generation session may; its kind,
   * run mode and action never change. Routine suggestions aren't rewritten.
   */
  async rewrite(changes: SuggestionChanges): Promise<SuggestionWriteOutcome> {
    const { about, ...rest } = changes;
    return outcome(
      this.client,
      unwrap(
        await this.client.scheduledAction.rewriteSuggestion({
          path: { id: this.id },
          body: { ...rest, about: about ? targets(about) : undefined },
        }),
      ),
    );
  }

  /**
   * Attach a reply draft to this open reply suggestion, with a `reason`; it replaces
   * the suggestion's old draft. Only a suggestions generation session may. The draft is
   * the user's own unsent draft in the thread the suggestion is about, from
   * `macro.email.createDraft({thread, replyingTo, ...}, await thread.link())`.
   * Nothing is sent.
   */
  async attachDraft(
    draft: EmailDraft,
    reason: string,
  ): Promise<SuggestionWriteOutcome> {
    return outcome(
      this.client,
      unwrap(
        await this.client.scheduledAction.attachSuggestionDraft({
          path: { id: this.id },
          body: { emailDraftId: draft.id, reason },
        }),
      ),
    );
  }

  /**
   * Retire this open suggestion because it no longer matters, with a `reason`. Only
   * a suggestions generation session may. Suggesting its `dedupKey` again brings
   * it back.
   */
  async retire(reason: string): Promise<SuggestionWriteOutcome> {
    return outcome(
      this.client,
      unwrap(
        await this.client.scheduledAction.retireSuggestion({
          path: { id: this.id },
          body: { reason },
        }),
      ),
    );
  }
}
