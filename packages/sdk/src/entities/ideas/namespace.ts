import type {
  Category,
  EntityAction,
  RunMode,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import {
  Idea,
  type IdeaItem,
  type IdeaWriteOutcome,
  outcome,
  targets,
} from './idea';

/** What an ideas session reads before managing the user's ideas. */
export interface IdeaReview {
  /** Open ideas first, best first, then closed ones newest first. */
  readonly ideas: Idea[];
  /** Open ideas the user has, and the most they may have. */
  readonly open: number;
  readonly openLimit: number;
  /** Ideas this session's generation may still add or bring back. */
  readonly newLeft: number;
}

/** Fields every new idea has. */
interface IdeaBase {
  /** A short lowercase key, the same every night for the same idea, such as `thread:<id>:reply`. */
  dedupKey: string;
  /** What to do, in a few words. Names no one's email address, phone number or street address. */
  title: string;
  /** Why, in a line or two, likewise. */
  summary: string;
  /** 0 to 100. */
  importance: number;
  categories?: Category[];
  /** The items it is about, as handles the SDK returned. */
  about?: IdeaItem[];
  /** Why, for the change log; required to bring back an idea the user dismissed. */
  reason?: string;
}

/** A new idea, or a new version of the one with the same `dedupKey`. */
export type IdeaSuggestion =
  | (IdeaBase & {
      kind: 'prompt';
      /** What an agent is asked to do, as the user would ask it. */
      prompt: string;
      /** `composer`: opened prefilled for the user to send. `background`: run in a hidden session, the user sees the result. */
      runMode: RunMode;
      /** Only for `background`: what the run posts or sends, and where, in one plain sentence ("Posts the weekly status summary in #ops"). The card shows it, and running the idea approves exactly that; leave it out when the run posts and sends nothing. */
      sends?: string;
    })
  | (IdeaBase & {
      kind: 'entity';
      /** What to do about the items in `about` (at least one). */
      action: EntityAction;
    });

/**
 * The user's ideas: proactive suggestions in their feed.
 *
 * @routing Use when an ideas generation session manages the user's Ideas feed of proactive suggestions; not for requests from the user, since any other session gets a 403.
 *
 * @agent
 * ## Ideas
 *
 * - Only an ideas generation session may call these; any other session gets a 403.
 * - Read every idea first with `macro.ideas.review()`. Then add with `suggest`, change with `idea.rewrite`, and retire with `idea.retire` what no longer matters.
 * - Each write answers `{ ok, problems }`: when `ok` is false, fix what `problems` says and try again.
 * - Name items in `about`, never in words: titles, summaries and prompts name no one's email address, phone number or street address.
 *
 * @mcp-exclude Ideas are written by hidden generation sessions and acted on in the app, not over MCP.
 */
export class IdeaNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Every idea of the user's, open or not, and how many more may be added. */
  async review(): Promise<IdeaReview> {
    const review = unwrap(await this.client.scheduledAction.reviewIdeas());
    return {
      ideas: review.ideas.map((idea) => Idea.from(this.client, idea)),
      open: review.open,
      openLimit: review.openLimit,
      newLeft: review.newLeft,
    };
  }

  /**
   * Add an idea, or a new version of the one with the same `dedupKey`: an
   * open one is updated in place, a retired one comes back, and a dismissed
   * one comes back only with a `reason`. Its kind never changes.
   *
   * @example
   * const outcome = await macro.ideas.suggest({
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
  async suggest(suggestion: IdeaSuggestion): Promise<IdeaWriteOutcome> {
    const { about, ...rest } = suggestion;
    return outcome(
      this.client,
      unwrap(
        await this.client.scheduledAction.suggestIdea({
          body: { ...rest, about: targets(about ?? []) },
        }),
      ),
    );
  }
}
