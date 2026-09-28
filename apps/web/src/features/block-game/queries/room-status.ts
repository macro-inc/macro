import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@app/features/property/identifiers';
import { propertiesServiceClient } from '@service-properties/client';
import { match } from 'ts-pattern';
import type { GameStatus } from '../core/status';

function statusOption(status: GameStatus): string {
  return match(status)
    .with('waiting', () => PROPERTY_OPTION_IDS.STATUS.NOT_STARTED)
    .with('in_progress', () => PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS)
    .with('finished', () => PROPERTY_OPTION_IDS.STATUS.COMPLETED)
    .exhaustive();
}

/** The room state a published Status option stands for, if any. */
export function gameStatusFromOption(
  optionId: string | undefined
): GameStatus | undefined {
  return match(optionId)
    .with(PROPERTY_OPTION_IDS.STATUS.NOT_STARTED, () => 'waiting' as const)
    .with(PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS, () => 'in_progress' as const)
    .with(PROPERTY_OPTION_IDS.STATUS.COMPLETED, () => 'finished' as const)
    .otherwise(() => undefined);
}

/** The Status option stored on a room, or undefined when unset or unreadable. */
async function storedStatusOption(
  documentId: string
): Promise<string | undefined> {
  const result = await propertiesServiceClient.getEntityProperties({
    entity_type: 'DOCUMENT',
    entity_id: documentId,
    query: { include_metadata: false },
  });
  if (result.isErr()) return undefined;
  const value = result.value.properties.find(
    (entry) =>
      entry.property.property_definition_id === SYSTEM_PROPERTY_IDS.STATUS
  )?.value;
  return value?.type === 'SelectOption' ? value.value[0] : undefined;
}

/**
 * Store a room's state as the document's system Status, which lists, previews
 * and channel mentions already render. Every editor derives the same value, but
 * each write is recorded as document activity, so a value another client has
 * already stored is left alone.
 */
export async function publishRoomStatus(
  documentId: string,
  status: GameStatus
): Promise<boolean> {
  const option = statusOption(status);
  if ((await storedStatusOption(documentId)) === option) return true;
  const result = await propertiesServiceClient.setEntityProperty({
    entity_type: 'DOCUMENT',
    entity_id: documentId,
    property_id: SYSTEM_PROPERTY_IDS.STATUS,
    body: { value: { type: 'select_option', option_id: option } },
  });
  if (result.isErr()) {
    console.error('Failed to publish game status', result.error);
    return false;
  }
  return true;
}
