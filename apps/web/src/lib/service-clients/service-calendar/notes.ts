import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type {
  DocumentNoteLink,
  LinkNoteRequest,
  MeetingNote,
  NotePicker,
} from './generated/schemas';

const host = SERVER_HOSTS['calendar-service'];

export const calendarNotesClient = {
  documentLinks(documentId: string, signal?: AbortSignal) {
    return fetchWithToken<DocumentNoteLink[]>(
      `${host}/meeting-notes/documents/${encodeURIComponent(documentId)}/links`,
      { signal }
    );
  },
  list(eventId: string, occurrenceKey: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ occurrenceKey });
    return fetchWithToken<MeetingNote[]>(
      `${host}/events/${encodeURIComponent(eventId)}/notes?${query}`,
      { signal }
    );
  },
  documents(query: string, signal?: AbortSignal) {
    return fetchWithToken<NotePicker>(
      `${host}/meeting-notes/documents?${new URLSearchParams({ query })}`,
      { signal }
    );
  },
  link(
    eventId: string,
    occurrenceKey: string,
    documentId: string,
    body: LinkNoteRequest
  ) {
    return fetchWithToken<Record<string, never>>(
      `${host}/events/${encodeURIComponent(eventId)}/notes/${encodeURIComponent(documentId)}?${new URLSearchParams({ occurrenceKey })}`,
      { method: 'PUT', body: JSON.stringify(body) }
    );
  },
  unlink(eventId: string, occurrenceKey: string, documentId: string) {
    return fetchWithToken<Record<string, never>>(
      `${host}/events/${encodeURIComponent(eventId)}/notes/${encodeURIComponent(documentId)}?${new URLSearchParams({ occurrenceKey })}`,
      { method: 'DELETE' }
    );
  },
};
