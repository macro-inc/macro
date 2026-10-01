import type { ReminderEntity } from '@entity';
import type {
  SoupReminderReference,
  SoupReminderSoupPropertiesField,
} from '@service-storage/generated/schemas';
import { match, P } from 'ts-pattern';
type ReferencedEntityType = NonNullable<
  ReminderEntity['referencedEntity']
>['type'];

function toReferencedEntity(
  reference: SoupReminderReference | null | undefined
): ReminderEntity['referencedEntity'] {
  if (!reference) return undefined;
  const type = match<string, ReferencedEntityType | undefined>(
    reference.entityType
  )
    .with('email_thread', () => 'email')
    .with('foreign_entity', () => 'foreign')
    .with(
      P.union(
        'document',
        'chat',
        'agent_session',
        'project',
        'channel',
        'channel_message',
        'call',
        'crm_company',
        'crm_contact'
      ),
      (t) => t
    )
    .otherwise(() => undefined);
  if (!type) return undefined;
  return {
    id: reference.id,
    type,
    fileType: reference.fileType ?? undefined,
    subType: reference.subType ?? undefined,
  };
}

export function reminderEntityFromData(
  data: Omit<SoupReminderSoupPropertiesField, 'properties'>,
  frecencyScore?: number
): ReminderEntity {
  const schedule = data.schedule;
  const recurring = schedule.type === 'recurring';
  return {
    type: 'reminder',
    id: data.id,
    // A reminder has no separate title — its description is its name.
    name: data.description,
    description: data.description,
    // Reminders are private to their owner, so the row carries no owner id.
    ownerId: '',
    referencedEntity: toReferencedEntity(data.referencedEntity),
    scheduleType: recurring ? 'recurring' : 'once',
    cron: recurring ? schedule.cron : undefined,
    timezone: recurring ? schedule.timezone : undefined,
    nextRunAt: data.nextRunAt,
    enabled: data.enabled,
    completedAt: data.completedAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    // Soup orders reminders by when they fire, not when they changed.
    sortTs: data.nextRunAt,
    frecencyScore: frecencyScore,
  } satisfies ReminderEntity;
}
