import type {
  Category,
  EntityAction,
  RunMode,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import {
  outcome,
  Suggestion,
  type SuggestionItem,
  type SuggestionWriteOutcome,
  targets,
} from './suggestion';

/** What a suggestions session reads before managing the user's suggestions. */
export interface SuggestionsReview {
  /** Open suggestions first, best first, then closed ones newest first. */
  readonly suggestions: Suggestion[];
  /** Open suggestions the user has, and the most they may have. */
  readonly open: number;
  readonly openLimit: number;
  /** Suggestions this session's generation may still add or bring back. */
  readonly newLeft: number;
}

/** Fields every new suggestion has. */
interface SuggestionBase {
  /** A short lowercase key, the same every night for the same suggestion, such as `thread:<id>:reply`. */
  dedupKey: string;
  /** What to do, in a few words. Names no one's email address, phone number or street address. */
  title: string;
  /** Why, in a line or two, likewise. */
  summary: string;
  /** 0 to 100. */
  importance: number;
  categories?: Category[];
  /** The items it is about, as handles the SDK returned. */
  about?: SuggestionItem[];
  /** Why, for the change log; required to bring back a suggestion the user dismissed. */
  reason?: string;
}

/** A new suggestion, or a new version of the one with the same `dedupKey`. */
export type SuggestionInput =
  | (SuggestionBase & {
      kind: 'prompt';
      /** What an agent is asked to do, as the user would ask it. */
      prompt: string;
      /** `composer`: opened prefilled for the user to send. `background`: run in a hidden session, the user sees the result. */
      runMode: RunMode;
    })
  | (SuggestionBase & {
      kind: 'entity';
      /** What to do about the items in `about` (at least one). */
      action: EntityAction;
    });

/**
 * The user's suggestions: proactive suggestions in their feed.
 *
 * @routing Use when a suggestions generation session manages the user's Suggestions feed of proactive suggestions; not for requests from the user, since any other session gets a 403.
 *
 * @agent
 * ## Suggestions
 *
 * - Only a suggestions generation session may call these; any other session gets a 403.
 * - Read every suggestion first with `macro.suggestions.review()`. Then add with `suggest`, change with `suggestion.rewrite`, and retire with `suggestion.retire` what no longer matters.
 * - Each write answers `{ ok, problems }`: when `ok` is false, fix what `problems` says and try again.
 * - Name items in `about`, never in words: titles, summaries and prompts name no one's email address, phone number or street address.
 *
 * @mcp-exclude Suggestions are written by hidden generation sessions and acted on in the app, not over MCP.
 */
export class SuggestionNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Every suggestion of the user's, open or not, and how many more may be added. */
  async review(): Promise<SuggestionsReview> {
    const review = unwrap(
      await this.client.scheduledAction.reviewSuggestions(),
    );
    return {
      suggestions: review.suggestions.map((suggestion) =>
        Suggestion.from(this.client, suggestion),
      ),
      open: review.open,
      openLimit: review.openLimit,
      newLeft: review.newLeft,
    };
  }

  /**
   * Add a suggestion, or a new version of the one with the same `dedupKey`: an
   * open one is updated in place, a retired one comes back, and a dismissed
   * one comes back only with a `reason`. Its kind never changes.
   *
   * @example
   * const outcome = await macro.suggestions.suggest({
   *   kind: 'entity',
   *   dedupKey: `thread:${thread.id}:reply`,
   *   title: 'Reply to the venue',
   *   summary: 'They asked for a headcount by Friday.',
   *   importance: 80,
   *   categories: ['important'],
   *   about: [{ entity: thread }],
   *   action: 'reply',
   * });
   * if (!outcome.ok) return outcome.problems;
   */
  async suggest(suggestion: SuggestionInput): Promise<SuggestionWriteOutcome> {
    const { about, ...rest } = suggestion;
    return outcome(
      this.client,
      unwrap(
        await this.client.scheduledAction.addSuggestion({
          body: { ...rest, about: targets(about ?? []) },
        }),
      ),
    );
  }
}
