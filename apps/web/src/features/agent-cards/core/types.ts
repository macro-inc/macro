/** The kinds of workspace item an item card shows. */
export const CARD_ITEM_TYPES = [
  'document',
  'email_thread',
  'calendar_event',
  'project',
  'channel',
  'routine',
  'form',
  'initiative',
] as const;

/** The kinds of workspace item an item card shows. */
export type CardItemType = (typeof CARD_ITEM_TYPES)[number];

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
