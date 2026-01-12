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

type UploadDraftAttachmentsReturn = {
  attachments: { file: File; attachmentID: string }[];
};

export const useUploadDraftAttachmentsMutation = (
  callbacks?: MutationCallbacks<
    UploadDraftAttachmentsReturn,
    Error,
    UploadDraftAttachmentsParams
  >
) => {
  return useMutation(() => ({
    mutationFn: async (params: UploadDraftAttachmentsParams) => {
      const uploadedAttachmentIDs = [];

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

        uploadedAttachmentIDs.push({
          file: attachment,
          attachmentID: result.attachment_id,
        });

        const uploaded = await uploadToPresignedUrl({
          presignedUrl: result.upload_url,
          sha,
          buffer: arrayBuffer,
          type: result.content_type,
        });

        if (uploaded.length && uploaded[0]?.length) {
          const err = uploaded[0][0];
          throw new Error(err.message, { cause: err.code });
        }
      }

      return { attachments: uploadedAttachmentIDs };
    },
    ...withCallbacks<
      UploadDraftAttachmentsReturn,
      Error,
      UploadDraftAttachmentsParams
    >({}, callbacks),
  }));
};

type RemoveDraftAttachmentParams = {
  draftID: string;
  attachmentID: string;
};

export const useRemoveDraftAttachmentMutation = (
  callbacks?: MutationCallbacks<void, Error, RemoveDraftAttachmentParams>
) => {
  return useMutation(() => ({
    mutationFn: async (params: RemoveDraftAttachmentParams) => {
      await throwOnErr(
        async () =>
          await emailClient.removeDraftAttachment({
            draftID: params.draftID,
            attachmentID: params.attachmentID,
          })
      );
    },
    ...withCallbacks<void, Error, RemoveDraftAttachmentParams>({}, callbacks),
  }));
};
