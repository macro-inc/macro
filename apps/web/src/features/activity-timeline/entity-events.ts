import type { DateValue } from '@core/util/date';
import type { EntityData } from '@entity';
import type { EntityEventVerb, TimelineItem } from './timeline-types';

/**
 * A document whose updatedAt is within this window of createdAt renders as a
 * single "created" event; beyond it, the row splits into a "created" event
 * at creation time plus an "edited" event at last-update time. There is no
 * server-side edit log (the CRDT blame table keeps only the last editor per
 * node), so the edit event carries no diff — just the fact of the edit.
 */
const EDIT_SPLIT_WINDOW_MS = 60 * 1000;

/**
 * Document types the user actually authors inside Macro. Other file types
 * (pdf, docx, images, …) mostly reach the workspace through ingestion
 * pipelines — email-attachment parsing, bulk-upload extraction — and their
 * updatedAt also moves on viewer activity (e.g. opening a PDF), so treating
 * them as created/edited would fabricate actions the user never took.
 */
const AUTHORABLE_FILE_TYPES: ReadonlySet<string> = new Set(['md', 'canvas']);

function isAuthorableDocument(entity: EntityData): boolean {
  if (entity.type !== 'document') return false;
  if (entity.subType?.type === 'task') return true;
  return AUTHORABLE_FILE_TYPES.has(entity.fileType ?? '');
}

function tsOf(value: DateValue | null | undefined): number | undefined {
  if (value == null) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The timestamp a soup row sorts by. Soup activity feeds query with
 * `sort_method: 'updated_at'`, and `sortTs` (when present) mirrors the
 * server-side sort key. The primary event of every row uses this timestamp;
 * events synthesized at older timestamps (document "created") are handled by
 * the feed's completeness boundary.
 */
function entitySortTs(entity: EntityData): number | undefined {
  return (
    tsOf(entity.sortTs) ?? tsOf(entity.updatedAt) ?? tsOf(entity.createdAt)
  );
}

function event(
  entity: EntityData,
  verb: EntityEventVerb,
  ts: number | undefined,
  idSuffix = ''
): TimelineItem | undefined {
  if (ts === undefined) return undefined;
  return {
    kind: 'entity-event',
    id: `${entity.type}:${entity.id}${idSuffix}`,
    ts,
    verb,
    entity,
  };
}

/**
 * Events for a document/task row: an "edited" event at last-update time and,
 * when the row is old enough for the two to be distinct, a separate
 * "created" event back at creation time.
 */
function documentEvents(
  entity: EntityData,
  createdVerb: EntityEventVerb,
  editedVerb: EntityEventVerb
): (TimelineItem | undefined)[] {
  const created = tsOf(entity.createdAt);
  const updated = entitySortTs(entity);
  if (
    created === undefined ||
    updated === undefined ||
    updated - created < EDIT_SPLIT_WINDOW_MS
  ) {
    return [event(entity, createdVerb, updated)];
  }
  return [
    event(entity, editedVerb, updated),
    event(entity, createdVerb, created, ':created'),
  ];
}

/**
 * Map a soup row from the "Things I did" query to personal activity events.
 * The query already scopes every entity type to the user's own actions
 * (sender/owner/attendance filters + the sent email view); this assigns the
 * verb(s) each row stands for. Rows with no timeline meaning map to nothing.
 */
export function mapMyActivityEntity(
  entity: EntityData,
  userId: string | undefined
): TimelineItem[] {
  const events = (): (TimelineItem | undefined)[] => {
    switch (entity.type) {
      case 'channel_thread':
        // The query filters threads by participation; whether this was my
        // message or a thread I replied in depends on who sent the root.
        return [
          event(
            entity,
            entity.senderId === userId ? 'sent-message' : 'replied-in-thread',
            entitySortTs(entity)
          ),
        ];
      case 'email':
        return [
          event(
            entity,
            entity.isDraft ? 'drafted-email' : 'sent-email',
            entitySortTs(entity)
          ),
        ];
      case 'document':
        if (!isAuthorableDocument(entity)) return [];
        return entity.subType?.type === 'task'
          ? documentEvents(entity, 'created-task', 'edited-task')
          : documentEvents(entity, 'created-document', 'edited-document');
      case 'project':
        return [event(entity, 'created-folder', entitySortTs(entity))];
      case 'chat':
        return [event(entity, 'agent-chat', entitySortTs(entity))];
      case 'call':
        return [event(entity, 'attended-call', entitySortTs(entity))];
      default:
        return [];
    }
  };

  return events().filter((item): item is TimelineItem => item !== undefined);
}

/**
 * Map a CRM-shared email thread row to a Firehose event. These are the
 * team-visible email threads (visibility inherited from CRM permissions);
 * the row's sender/snippet describe the latest message on the thread.
 */
export function mapSharedEmailEntity(entity: EntityData): TimelineItem[] {
  if (entity.type !== 'email' || entity.isDraft) return [];
  const item = event(entity, 'email-activity', entitySortTs(entity));
  return item ? [item] : [];
}

export { entitySortTs };
