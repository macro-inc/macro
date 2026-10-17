import {
  type AgentActivityCard,
  type AgentActivitySource,
  isAgentActivityCard,
} from '@macro-inc/lexical-core';
import type { CardAction, CardItem } from './types';

/**
 * A card as a run of steps shows it, once per item, attached to the step
 * that first touched the item.
 */
export type RunCard =
  | {
      kind: 'item';
      key: string;
      /** The step the card sits under. */
      rowId: string;
      item: CardItem;
      action: CardAction;
      title?: string | null;
      summary?: string | null;
    }
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
      kind: 'sources';
      key: string;
      /** The first step that found any. */
      rowId: string;
      /** What the run looked for, each search once. */
      queries: string[];
      sources: AgentActivitySource[];
      /** How many different things the run found in all. */
      total: number;
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

// Which of two things done to one item a receipt says: making or removing
// an item says more than sending it, and sending more than editing.
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

function sourceKey(source: AgentActivitySource): string {
  return source.kind === 'web'
    ? `web:${source.url}`
    : `${source.itemType}:${source.itemId}`;
}

/**
 * The cards a run of steps produced, in the order the steps produced them.
 * An item the run touched more than once is one card, under the step that
 * first touched it, saying the most significant thing done to it. What the
 * run's searches found is one sources card, under the first step that found
 * anything. A card this version cannot read is left out; the step's row
 * still says what it did.
 */
export function runCards(
  rows: readonly { id: string; card?: unknown }[]
): RunCard[] {
  const cards: RunCard[] = [];
  const items = new Map<string, Extract<RunCard, { kind: 'item' }>>();
  let found: Extract<RunCard, { kind: 'sources' }> | undefined;
  const seenSources = new Set<string>();
  for (const row of rows) {
    const card: unknown = row.card;
    if (!isAgentActivityCard(card)) continue;
    if (card.kind === 'view') {
      cards.push({ kind: 'view', key: row.id, rowId: row.id, view: card.view });
      continue;
    }
    if (card.kind === 'review') {
      cards.push({
        kind: 'review',
        key: `review:${card.reviewId}`,
        rowId: row.id,
        reviewId: card.reviewId,
        drafts: card.drafts,
      });
      continue;
    }
    if (card.kind === 'data') {
      cards.push({
        kind: 'data',
        key: row.id,
        rowId: row.id,
        sql: card.sql,
        databaseId: card.databaseId,
        display: card.display,
      });
      continue;
    }
    if (card.kind === 'sources') {
      if (!found) {
        found = {
          kind: 'sources',
          key: 'sources',
          rowId: row.id,
          queries: [],
          sources: [],
          total: 0,
        };
        cards.push(found);
      }
      const query = card.query?.trim();
      if (query && !found.queries.includes(query)) found.queries.push(query);
      // What two searches both found is one source, counted once.
      let repeated = 0;
      for (const source of card.sources) {
        const key = sourceKey(source);
        if (seenSources.has(key)) {
          repeated += 1;
          continue;
        }
        seenSources.add(key);
        found.sources.push(source);
      }
      found.total += Math.max(card.total - repeated, 0);
      continue;
    }
    const key = `${card.itemType}:${card.itemId}`;
    const seen = items.get(key);
    if (seen) {
      if (STRENGTH[card.action] > STRENGTH[seen.action]) {
        seen.action = card.action;
        seen.summary = card.summary;
      } else if (card.action === seen.action && card.summary !== seen.summary) {
        // Neither of two edits' summaries says what both did.
        seen.summary = null;
      }
      seen.title ??= card.title;
      continue;
    }
    const entry = itemCard(key, row.id, card);
    items.set(key, entry);
    cards.push(entry);
  }
  return cards;
}

function itemCard(
  key: string,
  rowId: string,
  card: Extract<AgentActivityCard, { kind: 'item' }>
): Extract<RunCard, { kind: 'item' }> {
  return {
    kind: 'item',
    key,
    rowId,
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
