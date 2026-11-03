import type {
  AgendaEvent,
  CardItemType,
  TagNode,
} from '@app/features/dynamic-ui/view';

export type { CardItemType };

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
export type AgendaEventRef = AgendaEvent;

/**
 * A tag of an ontology a card shows, and the narrower tags under it. The
 * colour is a palette name or hex; `tagId` names a tag that exists.
 */
export type OntologyTag = TagNode;
