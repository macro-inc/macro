import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { type UploadInput, uploadFiles } from '@core/util/upload';
import { useSplitLayout } from '../component/split-layout/layout';
import { refetchSoupEntity } from '@queries/soup/cache';

export function useHandleFileUpload({
  projectId,
}: {
  projectId?: string;
} = {}) {
  const { replaceOrInsertSplit } = useSplitLayout();

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

    // refetch soup for folders once all pending uploads are done
    Promise.allSettled(pendingUploads.map((upload) => upload.projectId)).then(
      (results) => {
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            refetchSoupEntity(result.value, 'project');
          }
        }
      }
    );

    // if there is a single file uploaded then open it
    if (successfulUploads.length !== 1 || failedUploads.length > 0) {
      return;
    }

    const upload = successfulUploads[0];
    // refetch the uploaded document into soup
    if (upload.type === 'document') {
      refetchSoupEntity(upload.documentId, 'document');
      replaceOrInsertSplit(
        {
          type: fileTypeToBlockName(upload.fileType),
          id: upload.documentId,
        },
        'file-upload'
      );
    }
  };
}
