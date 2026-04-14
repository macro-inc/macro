import { setFileType } from '@core/component/FileList/itemOperations';
import { toast } from '@core/component/Toast/Toast';
import { setHistoryItemFileType } from '@queries/history/history';
import { setPreviewFileType } from '@queries/preview';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
  type SoupTransaction,
} from '@queries/soup/cache';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { useMutation } from '@tanstack/solid-query';

type FileTypeUpdateVariables = {
  id: string;
  fileType: FileType;
  oldFileType: string | undefined;
};

function performOptimisticFileTypeUpdate(id: string, fileType: string) {
  setPreviewFileType(id, fileType);
  setHistoryItemFileType(id, fileType);

  const current = getSoupEntityById(id);
  const score = current?.frecency_score ?? 0;
  const soupTransaction = optimisticUpdateSoupEntity({
    tag: 'document',
    data: { id, fileType },
    frecency_score: score,
  });

  return { soupTransaction };
}

function rollbackFileTypeUpdate(
  id: string,
  oldFileType: string | undefined,
  soupTransaction: SoupTransaction
) {
  soupTransaction.rollback();
  if (oldFileType) {
    setPreviewFileType(id, oldFileType);
    setHistoryItemFileType(id, oldFileType);
  }
}

export function createUpdateFileTypeMutation() {
  return useMutation<
    boolean,
    Error,
    FileTypeUpdateVariables,
    { soupTransaction: SoupTransaction }
  >(() => ({
    mutationFn: async ({ id, fileType }) => {
      const success = await setFileType({ id, fileType });
      if (!success) {
        throw new Error('Failed to update file type');
      }
      return true;
    },
    onMutate: ({ id, fileType }) => {
      return performOptimisticFileTypeUpdate(id, fileType);
    },
    onError: (_error, { id, oldFileType }, context) => {
      toast.failure('Failed to update file type');
      if (context) {
        rollbackFileTypeUpdate(id, oldFileType, context.soupTransaction);
        return false;
      }
      return true;
    },
  }));
}
