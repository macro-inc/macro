import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { type UploadInput, uploadFiles } from '@core/util/upload';
import {
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import { useSplitLayout } from '../component/split-layout/layout';

export function useHandleFileUpload({
  projectId,
}: {
  projectId?: string;
} = {}) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const entityQueryClient = useEntityQueryClient();

  return async (files: UploadInput[]) => {
    const results = await uploadFiles(files, 'dss', {
      projectId,
    });

    const notFailedUploads = results.filter((result) => !result.failed);
    const failedUploads = results.filter((result) => result.failed);

    const successfulUploads = notFailedUploads.filter(
      (result) => !result.pending
    );

    const pendingUploads = notFailedUploads
      .filter((result) => result.pending)
      .filter((result) => result.type === 'folder');

    // update soup list folders once all pending uploads are done
    Promise.allSettled(pendingUploads.map((upload) => upload.projectId)).then(
      (results) => {
        const uploaded = results.filter(
          (result) => result.status === 'fulfilled' && result.value
        );
        if (uploaded.length > 0) {
          entityQueryClient.invalidateQueries({
            queryKey: queryKeys.all.dss,
          });
        }
      }
    );

    // if there is a single file uploaded then open it
    if (successfulUploads.length !== 1 || failedUploads.length > 0) {
      return;
    }

    // this refreshes the uploaded data into the soup list
    entityQueryClient.invalidateQueries({
      queryKey: queryKeys.all.dss,
    });

    const upload = successfulUploads[0];
    if (upload.type === 'document') {
      replaceOrInsertSplit({
        type: fileTypeToBlockName(upload.fileType),
        id: upload.documentId,
      });
    }
  };
}
