import type {
  CardAction,
  CardItem,
} from '@app/features/agent-cards/core/types';
import {
  type AgentActivityCard,
  isAgentActivityCard,
} from '@macro-inc/lexical-core';

/** A card as a run of steps shows it, once per item. */
export type RunCard =
  | {
      kind: 'item';
      key: string;
      item: CardItem;
      action: CardAction;
      title?: string | null;
    }
  | { kind: 'view'; key: string; view: unknown };

// Making an item says more than sending it, and sending more than editing.
const STRENGTH: Record<CardAction, number> = { created: 3, sent: 2, edited: 1 };

/** Whether a row's card is a view the agent composed for the user. */
export function isViewCard(card: unknown): boolean {
  return isAgentActivityCard(card) && card.kind === 'view';
}

/**
 * The cards a run of steps produced, in the order the steps produced them.
 * An item the run touched more than once is one card, at its first
 * appearance, saying the most significant thing done to it. A card this
 * version cannot read is left out; the step's row still says what it did.
 */
export function runCards(
  rows: readonly { id: string; card?: unknown }[]
): RunCard[] {
  const cards: RunCard[] = [];
  const items = new Map<string, Extract<RunCard, { kind: 'item' }>>();
  for (const row of rows) {
    const card: unknown = row.card;
    if (!isAgentActivityCard(card)) continue;
    if (card.kind === 'view') {
      cards.push({ kind: 'view', key: row.id, view: card.view });
      continue;
    }
    const key = `${card.itemType}:${card.itemId}`;
    const seen = items.get(key);
    if (seen) {
      if (STRENGTH[card.action] > STRENGTH[seen.action])
        seen.action = card.action;
      seen.title ??= card.title;
      continue;
    }
    const entry = itemCard(key, card);
    items.set(key, entry);
    cards.push(entry);
  }
  return cards;
}

function itemCard(
  key: string,
  card: Extract<AgentActivityCard, { kind: 'item' }>
): Extract<RunCard, { kind: 'item' }> {
  return {
    kind: 'item',
    key,
    item: { type: card.itemType, id: card.itemId, fileType: card.fileType },
    action: card.action,
    title: card.title,
  };
}
