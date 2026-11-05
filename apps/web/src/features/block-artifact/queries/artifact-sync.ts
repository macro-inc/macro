import { fireAndForget } from '@core/util/fireAndForget';
import { parseMessageData } from '@queries/storage/databases-sync';
import { useEntitySubscription } from '@service-connection/client';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type { Accessor } from 'solid-js';
import { z } from 'zod';
import { invalidateArtifact } from './artifact';

/**
 * Document storage pings the artifact's document subscribers after a publish
 * or restore, so open frames follow the current version.
 */
const ARTIFACT_PUBLISHED_MESSAGE_TYPE = 'artifact_published';
const artifactPublishedSchema = z.object({ documentId: z.string() });

/**
 * Track the artifact's document while it is shown, and re-read it after a
 * publish, a reconnect, or a long absence.
 */
export function useArtifactPublishedSync(documentId: Accessor<string>) {
  const refresh = (id: string) =>
    fireAndForget(invalidateArtifact(id), 'artifact-sync');

  useEntitySubscription(
    () => {
      const id = documentId();
      return id ? { entity_type: 'document', entity_id: id } : undefined;
    },
    (entity) => refresh(entity.entity_id)
  );

  createConnectionWebsocketEffect((message) => {
    if (message.type !== ARTIFACT_PUBLISHED_MESSAGE_TYPE) return;
    const published = parseMessageData(message, artifactPublishedSchema);
    if (!published || published.documentId !== documentId()) return;
    refresh(published.documentId);
  });
}
