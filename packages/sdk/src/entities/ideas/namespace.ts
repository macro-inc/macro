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
 * @routing Use when the user asks about their Ideas feed of proactive suggestions or wants to take one up or dismiss one, or when an ideas generation session manages that feed; not for routines, tasks or reminders the user asks to create.
 *
 * @agent
 * ## Ideas
 *
 * Each idea is a prompt to run, a note about specific items, or a routine suggestion.
 *
 * ### For the user
 *
 * - Read their feed with `macro.ideas.list()`: their open ideas, best first.
 * - When they take one up, call `idea.accept()`. A background prompt idea is then only taken on: the user starts its run from the app, so tell them it is ready to run there; never try to run it another way. Any other idea becomes done, so do it yourself: run a composer prompt idea's `prompt`, or do an entity idea's `action` on the items in `about`, using its `draft` when it has one.
 * - When they don't want one, call `idea.dismiss()`.
 * - Never suggest, rewrite or retire ideas for the user: only an ideas generation session may, and any other session gets a 403.
 *
 * ### In an ideas generation session
 *
 * - Read every idea first with `macro.ideas.review()`. Then add with `suggest`, change with `idea.rewrite`, and retire with `idea.retire` what no longer matters. Never `list`, `accept` or `dismiss`: those are the user's, and a generation session gets a 403.
 * - Each write answers `{ ok, problems }`: when `ok` is false, fix what `problems` says and try again.
 * - Name items in `about`, never in words: titles, summaries and prompts name no one's email address, phone number or street address.
 * - A reply idea may carry a reply draft: write it with `macro.email.createDraft({thread, replyingTo, ...}, await thread.link())`, never send it, and attach it with `idea.attachDraft(draft, reason)`. Write none in a thread that already holds a draft (`thread.drafts()`).
 */
export class IdeaNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * The user's feed: their open ideas about items they can still open, best
   * first. For the user's own agent; a generation session gets a 403.
   *
   * @example
   * const ideas = await macro.ideas.list();
   * return ideas.map((idea) => ({ title: idea.title, kind: idea.kind }));
   */
  async list(): Promise<Idea[]> {
    const feed = unwrap(await this.client.scheduledAction.listIdeas());
    return feed.ideas.map((idea) => Idea.from(this.client, idea));
  }

  /** Every idea of the user's, open or not, and how many more may be added. Only an ideas generation session may. */
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
