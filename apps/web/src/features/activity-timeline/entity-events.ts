import type { DateValue } from '@core/util/date';
import type { EntityData } from '@entity';
import type { EntityEventVerb, TimelineItem } from './timeline-types';

/**
 * Documents whose createdAt and updatedAt are within this window render as
 * "created" rather than "edited" — a fresh document is usually touched a few
 * times right after creation without those counting as meaningful edits.
 */
const CREATED_WINDOW_MS = 5 * 60 * 1000;

function tsOf(value: DateValue | null | undefined): number | undefined {
  if (value == null) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The timestamp a soup row sorts by. Soup activity feeds query with
 * `sort_method: 'updated_at'`, and `sortTs` (when present) mirrors the
 * server-side sort key — the emitted `ts` must match that ordering for the
 * feed merge to be correct.
 */
function entitySortTs(entity: EntityData): number | undefined {
  return (
    tsOf(entity.sortTs) ?? tsOf(entity.updatedAt) ?? tsOf(entity.createdAt)
  );
}

function event(
  entity: EntityData,
  verb: EntityEventVerb
): TimelineItem | undefined {
  const ts = entitySortTs(entity);
  if (ts === undefined) return undefined;
  return {
    kind: 'entity-event',
    id: `${entity.type}:${entity.id}`,
    ts,
    verb,
    entity,
  };
}

/**
 * Map a soup row from the "Things I did" query to a personal activity event.
 * The query already scopes every entity type to the user's own actions
 * (sender/owner/attendance filters + the sent email view); this assigns the
 * verb each row stands for. Rows with no timeline meaning map to undefined.
 */
export function mapMyActivityEntity(
  entity: EntityData,
  userId: string | undefined
): TimelineItem | undefined {
  switch (entity.type) {
    case 'channel_thread':
      // The query filters threads by participation; whether this was my
      // message or a thread I replied in depends on who sent the root.
      return event(
        entity,
        entity.senderId === userId ? 'sent-message' : 'replied-in-thread'
      );
    case 'email':
      return event(entity, entity.isDraft ? 'drafted-email' : 'sent-email');
    case 'document':
      if (entity.subType?.type === 'task') return event(entity, 'created-task');
      return event(entity, documentVerb(entity));
    case 'project':
      return event(entity, 'created-folder');
    case 'chat':
      return event(entity, 'agent-chat');
    case 'call':
      return event(entity, 'attended-call');
    default:
      return undefined;
  }
}

function documentVerb(
  entity: EntityData
): Extract<EntityEventVerb, 'created-document' | 'edited-document'> {
  const created = tsOf(entity.createdAt);
  const updated = tsOf(entity.updatedAt);
  if (created === undefined || updated === undefined) {
    return 'edited-document';
  }
  return updated - created < CREATED_WINDOW_MS
    ? 'created-document'
    : 'edited-document';
}

/**
 * Map a CRM-shared email thread row to a Firehose event. These are the
 * team-visible email threads (visibility inherited from CRM permissions);
 * the row's sender/snippet describe the latest message on the thread.
 */
export function mapSharedEmailEntity(
  entity: EntityData
): TimelineItem | undefined {
  if (entity.type !== 'email' || entity.isDraft) return undefined;
  return event(entity, 'email-activity');
}
