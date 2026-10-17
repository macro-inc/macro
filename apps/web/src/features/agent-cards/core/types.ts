import type {
  AGENT_ACTIVITY_CARD_ACTIONS,
  AGENT_ACTIVITY_CARD_ITEM_TYPES,
} from '@macro-inc/lexical-core';

/** The kinds of workspace item an agent card shows. */
export type CardItemType = (typeof AGENT_ACTIVITY_CARD_ITEM_TYPES)[number];

/** What an agent's step did to the item its card shows. */
export type CardAction = (typeof AGENT_ACTIVITY_CARD_ACTIONS)[number];

/** A workspace item a card shows, loaded with the viewer's own access. */
export type CardItem = {
  type: CardItemType;
  id: string;
  /** A document's file type, when known before it loads: `md`, `spreadsheet`. */
  fileType?: string | null;
  /** One instance of a recurring event. */
  occurrenceKey?: string;
};

/** A calendar event an agenda lists, by id and optional instance. */
export type AgendaEventRef = {
  eventId: string;
  occurrenceKey?: string;
};

/**
 * A tag of an ontology a card shows, and the narrower tags under it. The
 * colour is a palette name or hex; `tagId` names a tag that exists.
 */
export type OntologyTag = {
  label: string;
  color?: string;
  description?: string;
  tagId?: string;
  children?: readonly OntologyTag[];
};
