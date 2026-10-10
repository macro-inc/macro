/** The kinds of workspace item an agent card shows. */
export type CardItemType = 'document' | 'email_thread' | 'calendar_event';

/** What an agent's step did to the item its card shows. */
export type CardAction = 'created' | 'edited' | 'sent';

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
