import type {
  Category,
  EntityAction,
  Idea as IdeaRecord,
  IdeaState,
  IdeaWriteOutcome as IdeaWriteRecord,
  RunMode,
  RunProgress,
  Target,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { AgentSession } from '../agent-sessions/agent-session';
import { EmailDraft } from '../email/draft';
import type { MacroEntityType } from '../entity';

/** An item an idea is about: any handle with an entity type, such as an `EmailThread`, and optionally a part of it, such as one message in a channel. */
export interface IdeaItem {
  readonly entity: {
    readonly id: string;
    readonly entityType: MacroEntityType;
  };
  readonly part?: { readonly id: string };
}

/** What became of an ideas write: whether it was applied and, when not, the `problems` to fix before trying again. */
export interface IdeaWriteOutcome {
  readonly ok: boolean;
  readonly problems: string[];
  /** The idea as it now is, when the write was applied. */
  readonly idea?: Idea;
}

/** Changes to an open idea; fields left out stay as they are. */
export interface IdeaChanges {
  title?: string;
  summary?: string;
  importance?: number;
  categories?: Category[];
  about?: IdeaItem[];
  /** Only on prompt ideas. */
  prompt?: string;
  /** Only on background prompt ideas: what the run posts or sends, and where. */
  sends?: string;
  /** Why, for the change log. */
  reason: string;
}

/** The wire form of an idea's items. */
export function targets(items: IdeaItem[]): Target[] {
  return items.map((item) => ({
    entityType: item.entity.entityType,
    entityId: item.entity.id,
    partId: item.part?.id,
  }));
}

/** An ideas write's outcome, with its idea as a handle. */
export function outcome(
  client: MacroClient,
  record: IdeaWriteRecord,
): IdeaWriteOutcome {
  return {
    ok: record.ok,
    problems: record.problems,
    idea: record.idea ? Idea.from(client, record.idea) : undefined,
  };
}

/**
 * One of the user's ideas: a prompt to run, a note about specific items, or a
 * routine suggestion. List-sourced only, from `macro.ideas.review()`, so this
 * wraps the record the caller already has.
 *
 * @mcp-exclude Ideas are written by hidden generation sessions and acted on in the app, not over MCP.
 */
export class Idea {
  private constructor(
    private readonly client: MacroClient,
    private readonly record: IdeaRecord,
  ) {}

  /** Wrap an idea record already in hand. */
  static from(client: MacroClient, record: IdeaRecord): Idea {
    return new Idea(client, record);
  }

  /** The idea's record, so a program can return an idea or a write's outcome. */
  toJSON(): IdeaRecord {
    return this.record;
  }

  /** The idea's id. */
  get id(): string {
    return this.record.id;
  }

  /** `prompt`, `entity` or `routine`; never changes. */
  get kind(): IdeaRecord['kind'] {
    return this.record.kind;
  }

  /** Names the idea across nights; suggesting the same key again updates this idea. */
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
  get state(): IdeaState {
    return this.record.state;
  }

  /** When its state last changed, such as when the user dismissed it, as RFC 3339. */
  get stateChangedAt(): string {
    return this.record.stateChangedAt;
  }

  /** The items it is about, as `{ entityType, entityId, partId }`. */
  get about(): Target[] {
    return this.record.about;
  }

  /** A prompt idea's prompt. */
  get prompt(): string | undefined {
    return this.record.kind === 'prompt' ? this.record.prompt : undefined;
  }

  /** A prompt idea's run mode. */
  get runMode(): RunMode | undefined {
    return this.record.kind === 'prompt' ? this.record.runMode : undefined;
  }

  /**
   * What a background prompt idea's run posts or sends, and where, as its
   * card shows it before Run; running the idea approves exactly that.
   * Undefined when the run posts and sends nothing.
   */
  get sends(): string | undefined {
    return this.record.kind === 'prompt'
      ? (this.record.sends ?? undefined)
      : undefined;
  }

  /**
   * A background prompt idea's latest run: its hidden agent `session`
   * (open it to see the result), when it started, and its `progress`
   * (`running`, `finished`, `failed`, or `unknown` when the session
   * couldn't be read; `needs_approval` and `needs_input` only if it ever
   * waits, which a run is told never to).
   */
  get run():
    | { session: AgentSession; startedAt: string; progress: RunProgress }
    | undefined {
    const run = this.record.run;
    return run
      ? {
          session: AgentSession.byId(this.client, run.sessionId),
          startedAt: run.startedAt,
          progress: run.progress,
        }
      : undefined;
  }

  /** An entity idea's action. */
  get action(): EntityAction | undefined {
    return this.record.kind === 'entity' ? this.record.action : undefined;
  }

  /** A reply idea's draft, once a session attached one; it no longer loads once the user deleted it. */
  get draft(): EmailDraft | undefined {
    if (this.record.kind !== 'entity') return undefined;
    const partId = this.record.draft?.partId;
    return partId ? EmailDraft.byId(this.client, partId) : undefined;
  }

  /**
   * Rewrite this open idea's title, summary, prompt, importance, categories
   * or items, with a `reason`. Only an ideas generation session may; its kind,
   * run mode and action never change. Routine ideas aren't rewritten.
   */
  async rewrite(changes: IdeaChanges): Promise<IdeaWriteOutcome> {
    const { about, ...rest } = changes;
    return outcome(
      this.client,
      unwrap(
        await this.client.scheduledAction.rewriteIdea({
          path: { id: this.id },
          body: { ...rest, about: about ? targets(about) : undefined },
        }),
      ),
    );
  }

  /**
   * Attach a reply draft to this open reply idea, with a `reason`; it replaces
   * the idea's old draft. Only an ideas generation session may. The draft is
   * the user's own unsent draft in the thread the idea is about, from
   * `macro.email.createDraft({thread, replyingTo, ...}, await thread.link())`.
   * Nothing is sent.
   */
  async attachDraft(
    draft: EmailDraft,
    reason: string,
  ): Promise<IdeaWriteOutcome> {
    return outcome(
      this.client,
      unwrap(
        await this.client.scheduledAction.attachIdeaDraft({
          path: { id: this.id },
          body: { emailDraftId: draft.id, reason },
        }),
      ),
    );
  }

  /**
   * Retire this open idea because it no longer matters, with a `reason`. Only
   * an ideas generation session may. Suggesting its `dedupKey` again brings
   * it back.
   */
  async retire(reason: string): Promise<IdeaWriteOutcome> {
    return outcome(
      this.client,
      unwrap(
        await this.client.scheduledAction.retireIdea({
          path: { id: this.id },
          body: { reason },
        }),
      ),
    );
  }
}
