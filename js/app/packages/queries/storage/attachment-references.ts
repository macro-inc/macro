import { throwOnErr } from '@core/util/result';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import type { ApiAttachmentEntityReference } from '@service-storage/generated/schemas/apiAttachmentEntityReference';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { attachmentReferencesKeys } from './keys';

const ATTACHMENT_REFERENCES_STALE_TIME = 60 * 1000;

async function fetchAttachmentReferences(
  entityType: ItemType,
  entityId: string
): Promise<ApiAttachmentEntityReference[]> {
  const response = await throwOnErr(() =>
    storageServiceClient.attachmentReferences({
      entity_type: entityType,
      entity_id: entityId,
    })
  );

  return response.references;
}

export function useAttachmentReferencesQuery(
  entityId: Accessor<string | null | undefined>,
  entityType: Accessor<ItemType>
) {
  return useQuery(() => {
    const id = entityId();
    const type = entityType();

    return {
      queryKey: id
        ? attachmentReferencesKeys.list(type, id).queryKey
        : attachmentReferencesKeys.list._def,
      queryFn: () => {
        if (!id) {
          throw new Error(
            'Entity ID is required to fetch attachment references'
          );
        }
        return fetchAttachmentReferences(type, id);
      },
      staleTime: ATTACHMENT_REFERENCES_STALE_TIME,
      enabled: !!id,
    };
  });
}
