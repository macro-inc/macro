import { analytics } from '@app/lib/analytics';
import { contentHash } from '@core/util/hash';
import { invalidateUserQuota } from '@queries/auth';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { storageServiceClient } from '@service-storage/client';
import { type GameKind, gameDefinition } from '../core/catalog';

/**
 * Create a game room document named after its game. The backend seeds a blank
 * room; the creator's first open records which game it hosts.
 */
export async function createGameRoom(args: {
  kind: GameKind;
  projectId?: string;
  source?: string;
}): Promise<string | undefined> {
  const title = gameDefinition(args.kind).title;
  const created = await storageServiceClient.games.createRoom({
    documentName: title,
    projectId: args.projectId,
    sha: await contentHash(new Uint8Array()),
  });
  invalidateUserQuota();
  if (created.isErr()) {
    console.error('Failed to create game room', created.error);
    return;
  }

  const documentId = created.value.metadata.documentId;
  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: title,
    fileType: 'game',
  });
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });
  analytics.track('create_entity', {
    entityType: 'game',
    entityId: documentId,
    projectId: args.projectId,
    source: args.source,
    gameKind: args.kind,
  });
  return documentId;
}
