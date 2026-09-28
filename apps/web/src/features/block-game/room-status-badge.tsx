import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useEntityProperties } from '@property/hooks';
import type { Property } from '@property/types';
import type { PreviewDocumentProperties } from '@queries/preview/types';
import { Show } from 'solid-js';
import { GameStatusBadge } from './components/game-status-badge';
import { gameStatusFromOption } from './queries/room-status';

function statusOptionOf(
  properties: Property[] | undefined
): string | undefined {
  const status = properties?.find(
    (property) => property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS
  );
  return status?.valueType === 'SELECT_STRING' ? status.value?.[0] : undefined;
}

/**
 * A game room's published status for lists, previews and channel messages.
 * Read-only: the room recomputes its status from play, so an edit here would
 * simply be overwritten.
 */
export function GameRoomStatusBadge(props: {
  statusOptionId: string | undefined;
}) {
  return (
    <Show when={gameStatusFromOption(props.statusOptionId)}>
      {(status) => <GameStatusBadge status={status()} />}
    </Show>
  );
}

/** Previews carry properties on the GraphQL path; REST previews fetch them. */
export function GameRoomPreviewStatus(props: {
  documentId: string;
  previewProperties: PreviewDocumentProperties | undefined;
}) {
  return (
    <Show
      when={props.previewProperties}
      fallback={<FetchedGameRoomStatus documentId={props.documentId} />}
    >
      {(preview) => (
        <GameRoomStatusBadge
          statusOptionId={statusOptionOf(preview().properties)}
        />
      )}
    </Show>
  );
}

function FetchedGameRoomStatus(props: { documentId: string }) {
  const { properties, isLoading } = useEntityProperties(
    props.documentId,
    'DOCUMENT',
    false
  );
  return (
    <Show when={!isLoading()}>
      <GameRoomStatusBadge statusOptionId={statusOptionOf(properties())} />
    </Show>
  );
}
