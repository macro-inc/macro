import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { type UploadInput, uploadFiles } from '@core/util/upload';
import { refetchHistory } from '@queries/history/history';
import { refetchSoupEntity } from '@queries/soup/cache';
import { useSplitLayout } from '../component/split-layout/layout';

export function useHandleFileUpload({
  projectId,
}: {
  projectId?: string;
} = {}) {
  const { replaceOrInsertSplit, openWithSplit } = useSplitLayout();

  return async (files: UploadInput[], withOpen = true) => {
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

    // Refetch soup for folders once pending uploads are done, and show a success
    // toast with an action to open the created folder/project.
    for (const upload of pendingUploads) {
      upload.projectId.then((createdProjectId) => {
        if (!createdProjectId) return;

        refetchSoupEntity(createdProjectId, 'project', { includeRoot: true });
        refetchHistory();

        toast.success(`Uploaded ${upload.name}`, {
          actions: [
            {
              label: 'Open folder',
              onClick: () => {
                openWithSplit(
                  { type: 'project', id: createdProjectId },
                  { referredFrom: 'file-upload', activate: true }
                );
              },
            },
          ],
        });
      });
    }

    // refetch soup for uploaded docs
    for (const upload of successfulUploads) {
      if (upload.type === 'document') {
        refetchSoupEntity(upload.documentId, 'document');
      }
    }

    // optionally nav to singular uploaded doc
    if (
      withOpen &&
      successfulUploads.length === 1 &&
      failedUploads.length === 0
    ) {
      const upload = successfulUploads[0];
      if (upload.type === 'document') {
        replaceOrInsertSplit(
          {
            type: fileTypeToBlockName(upload.fileType),
            id: upload.documentId,
          },
          'file-upload'
        );
      }
    }
  };
}
