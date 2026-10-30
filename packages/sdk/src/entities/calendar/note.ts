import type {
  DocumentNoteLink,
  MeetingNote,
} from '../../../generated/calendar/types.gen';
import type { CalendarOccurrence } from '../../../generated/storage/types.gen';
import { MacroError, MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { MacroEntity } from '../entity';
import { Team } from '../teams/team';
import { CalendarEvent } from './event';

/** A markdown document linked to one meeting occurrence, with view-only access. */
export class CalendarNote extends MacroEntity<MeetingNote> {
  private constructor(
    client: MacroClient,
    readonly event: CalendarEvent,
    readonly occurrence: Pick<CalendarOccurrence, 'eventId' | 'occurrenceKey'>,
    document: Document,
    record?: MeetingNote,
    private readonly fromDocument = false,
  ) {
    super(client, document.id, record);
    if (occurrence.eventId !== event.id) {
      throw new MacroError('Choose an occurrence belonging to this event');
    }
  }

  /** Seed an owner-visible link that can be revoked even if the meeting is unavailable. */
  static fromDocumentLink(
    client: MacroClient,
    document: Document,
    link: DocumentNoteLink,
  ): CalendarNote {
    return new CalendarNote(
      client,
      CalendarEvent.byId(client, link.eventId),
      link,
      document,
      {
        documentId: document.id,
        name: link.documentName,
        team: link.team,
        canManage: true,
      },
      true,
    );
  }

  /** Construct a handle for a document already linked to this occurrence. */
  static forDocument(
    client: MacroClient,
    event: CalendarEvent,
    occurrence: CalendarOccurrence,
    document: Document,
  ): CalendarNote {
    return new CalendarNote(client, event, occurrence, document);
  }

  /** Seed a handle with a record returned by the meeting-note API. */
  static fromRecord(
    client: MacroClient,
    event: CalendarEvent,
    occurrence: CalendarOccurrence,
    record: MeetingNote,
  ): CalendarNote {
    return new CalendarNote(
      client,
      event,
      occurrence,
      Document.byId(client, record.documentId),
      record,
    );
  }

  protected async fetch(): Promise<MeetingNote> {
    if (this.fromDocument) {
      const links = unwrap(
        await this.client.calendar.documentNoteLinks({
          path: { document_id: this.id },
        }),
      );
      const link = links.find(
        (item) =>
          item.eventId === this.event.id &&
          item.occurrenceKey === this.occurrence.occurrenceKey,
      );
      if (!link)
        throw new MacroNotFoundError('This meeting link has been removed');
      return {
        documentId: this.id,
        name: link.documentName,
        team: link.team,
        canManage: true,
      };
    }
    const notes = unwrap(
      await this.client.calendar.eventNotes({
        path: { event_id: this.event.id },
        query: { occurrenceKey: this.occurrence.occurrenceKey },
      }),
    );
    const note = notes.find((item) => item.documentId === this.id);
    if (!note)
      throw new MacroNotFoundError(
        'This document is no longer linked to the meeting',
      );
    return note;
  }

  /** The original markdown document; unlinking never deletes it. */
  readonly document = this.mappedField('documentId', (id) =>
    Document.byId(this.client, id),
  );

  /** Current document name. */
  readonly name = this.field('name');

  /** Optional extra team audience. Meeting-detail viewers already have view access. */
  readonly team = this.mappedField('team', (team) =>
    team ? Team.byId(this.client, team.id) : undefined,
  );

  /** Whether the caller may change this link's sharing. */
  readonly canManage = this.field('canManage');

  /** Change the extra team view grant; omit the team to remove it. Requires document ownership. */
  async setTeam(team?: Team): Promise<void> {
    await this.mutate((client) =>
      client.calendar.linkEventNote({
        path: { event_id: this.event.id, document_id: this.id },
        query: { occurrenceKey: this.occurrence.occurrenceKey },
        body: { teamId: team?.id ?? null },
      }),
    );
  }

  /** Remove this occurrence's link and view grants, preserving the document and other sharing. */
  async unlink(): Promise<void> {
    await this.mutate((client) =>
      client.calendar.unlinkEventNote({
        path: { event_id: this.event.id, document_id: this.id },
        query: { occurrenceKey: this.occurrence.occurrenceKey },
      }),
    );
  }
}
