import {
  type AgentActivityCard,
  isAgentActivityCard,
} from '@macro-inc/lexical-core';
import type { CardAction, CardItem } from './types';

/**
 * Something the agent chose to show the user, as a run of steps shows it:
 * a view it composed, a database answer it asked to show, or drafts it saved
 * for review. What a step did to an item is not one of them: the step's row
 * names the item, and a view that shows the item says what was done to it.
 */
export type RunCard =
  | { kind: 'view'; key: string; rowId: string; view: unknown }
  | {
      kind: 'data';
      key: string;
      rowId: string;
      sql: string;
      databaseId?: string | null;
      display?: string | null;
    }
  | {
      kind: 'review';
      key: string;
      rowId: string;
      /** The saved review the agent presented. */
      reviewId: string;
      /** What its drafts are: emails, or events. */
      drafts: 'email' | 'calendar';
    };

/** What a reply's steps did to one item they created, changed or sent. */
export type ItemFact = {
  item: CardItem;
  action: CardAction;
  /** The item's name as the agent knew it, until it loads. */
  title?: string | null;
  /** What happened to it, in a few words, while one step says it all. */
  summary?: string | null;
};

// Which of two things done to one item a fact says: making or removing an
// item says more than sending it, and sending more than editing.
const STRENGTH: Record<CardAction, number> = {
  created: 9,
  deleted: 8,
  sent: 7,
  shared: 6,
  moved: 5,
  renamed: 4,
  edited: 3,
  updated: 3,
  commented: 2,
  failed: 1,
};

/**
 * Whether a row's card is shown in place of its step: a view the agent
 * composed for the user, or drafts it saved for the user to review. Showing
 * them is what the step did.
 */
export function replacesStep(card: unknown): boolean {
  return (
    isAgentActivityCard(card) &&
    (card.kind === 'view' || card.kind === 'review')
  );
}

/** The key an item goes by among a reply's facts: its kind and id. */
export function itemKey(item: { type: string; id: string }): string {
  return `${item.type}:${item.id}`;
}

/** The item a step created, changed or sent, which its row names. */
export function stepItem(card: unknown): ItemFact | undefined {
  if (!isAgentActivityCard(card) || card.kind !== 'item') return undefined;
  return itemFact(card);
}

/**
 * What a reply's steps did to each item they touched, by `itemKey`: an item
 * touched more than once is one fact, saying the most significant thing
 * done to it. A view that shows the item says it on the item's card.
 */
export function itemFacts(
  rows: readonly { card?: unknown }[]
): ReadonlyMap<string, ItemFact> {
  const facts = new Map<string, ItemFact>();
  for (const row of rows) {
    const fact = stepItem(row.card);
    if (!fact) continue;
    const key = itemKey(fact.item);
    const seen = facts.get(key);
    if (!seen) {
      facts.set(key, fact);
      continue;
    }
    if (STRENGTH[fact.action] > STRENGTH[seen.action]) {
      seen.action = fact.action;
      seen.summary = fact.summary;
    } else if (fact.action === seen.action && fact.summary !== seen.summary) {
      // Neither of two edits' summaries says what both did.
      seen.summary = null;
    }
    seen.title ??= fact.title;
  }
  return facts;
}

/**
 * What the agent chose to show in a run of steps, in the order it showed
 * it, each under the step that showed it. A card this version cannot read
 * is left out; the step's row still says what it did.
 */
export function runCards(
  rows: readonly { id: string; card?: unknown }[]
): RunCard[] {
  const cards: RunCard[] = [];
  for (const row of rows) {
    const card: unknown = row.card;
    if (!isAgentActivityCard(card)) continue;
    if (card.kind === 'view') {
      cards.push({ kind: 'view', key: row.id, rowId: row.id, view: card.view });
    } else if (card.kind === 'review') {
      cards.push({
        kind: 'review',
        key: `review:${card.reviewId}`,
        rowId: row.id,
        reviewId: card.reviewId,
        drafts: card.drafts,
      });
    } else if (card.kind === 'data') {
      cards.push({
        kind: 'data',
        key: row.id,
        rowId: row.id,
        sql: card.sql,
        databaseId: card.databaseId,
        display: card.display,
      });
    }
  }
  return cards;
}

function itemFact(
  card: Extract<AgentActivityCard, { kind: 'item' }>
): ItemFact {
  return {
    item: { type: card.itemType, id: card.itemId, fileType: card.fileType },
    action: card.action,
    title: card.title,
    summary: card.summary,
  };
}

/**
 * How long a finished run took, from when its message was first posted to
 * when it last changed, worded like a stopwatch: `18s`, `1m 12s`. Nothing
 * for a run too short to be worth saying.
 */
export function runDuration(
  postedAt: string | undefined,
  changedAt: string | undefined
): string | undefined {
  if (!postedAt || !changedAt) return undefined;
  const seconds = Math.round(
    (new Date(changedAt).getTime() - new Date(postedAt).getTime()) / 1000
  );
  if (!Number.isFinite(seconds) || seconds < 2) return undefined;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}
