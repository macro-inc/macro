import { contentHash } from '@core/util/hash';
import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { emailClient } from '@service-email/client';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { useMutation } from '@tanstack/solid-query';

type UploadDraftAttachmentsParams = {
  draftID: string;
  attachments: File[];
};

export const useUploadDraftAttachmentsMutation = (
  callbacks?: MutationCallbacks<void, Error, UploadDraftAttachmentsParams>
) => {
  return useMutation(() => ({
    mutationFn: async (params: UploadDraftAttachmentsParams) => {
      for (const attachment of params.attachments) {
        const arrayBuffer = await attachment.arrayBuffer();
        const sha = await contentHash(arrayBuffer);

        const result = await throwOnErr(
          async () =>
            await emailClient.addDraftAttachment({
              draftID: params.draftID,
              attachment: {
                file_name: attachment.name,
                size: attachment.size,
                sha,
              },
            })
        );

        if (result.status !== 201) return;

        const uploaded = await uploadToPresignedUrl({
          presignedUrl: result.data.upload_url,
          sha,
          buffer: arrayBuffer,
          type: result.data.content_type,
        });

        if (uploaded.length && uploaded[0]?.length) {
          const err = uploaded[0][0];
          throw new Error(err.message, { cause: err.code });
        }
      }
    },
    ...withCallbacks<void, Error, UploadDraftAttachmentsParams>({}, callbacks),
  }));
};
