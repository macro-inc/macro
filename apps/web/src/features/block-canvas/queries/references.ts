import { getPermissionToken } from '@core/signal/token';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { attachmentReferencesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import type { CanvasReferenceSource } from '../context/reference-source';

/** Same entity-mention API and reference query invalidation used by mentions. */
export function canvasReferenceSource(sourceId: string): CanvasReferenceSource {
  async function token() {
    const token = await getPermissionToken('document', sourceId);
    if (!token)
      throw new Error('Could not authorize canvas reference tracking');
    return token;
  }
  return {
    async create(targetId) {
      const permission = await token();
      const mention = await throwOnErr(() =>
        storageServiceClient.createEntityMention(
          {
            source_entity_type: 'document',
            source_entity_id: sourceId,
            entity_type: 'document',
            entity_id: targetId,
          },
          permission
        )
      );
      void queryClient.invalidateQueries({
        queryKey: attachmentReferencesKeys.list('document', targetId).queryKey,
      });
      return mention.id;
    },
    async remove(mentionId) {
      const response = await storageServiceClient.deleteEntityMention(
        { mention_id: mentionId },
        await token()
      );
      // The file can retain a completed deletion until its next content save.
      if (
        !(
          response.isErr() &&
          response.error.every((error) => error.code === 'NOT_FOUND')
        )
      )
        await throwOnErr(async () => response);
      void queryClient.invalidateQueries({
        queryKey: attachmentReferencesKeys.list._def,
      });
    },
  };
}
