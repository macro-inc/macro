import type {
  Category,
  EntityAction,
  RunMode,
  Suggestion as SuggestionRecord,
  SuggestionState,
  SuggestionWriteOutcome as SuggestionWriteRecord,
  Target,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { MacroEntityType } from '../entity';

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
 * routine suggestion. List-sourced only, from `macro.suggestions.review()`, so this
 * wraps the record the caller already has.
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

  /** An entity suggestion's action. */
  get action(): EntityAction | undefined {
    return this.record.kind === 'entity' ? this.record.action : undefined;
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
