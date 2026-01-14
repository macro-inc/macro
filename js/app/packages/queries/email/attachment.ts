import { toast } from '@core/component/Toast/Toast';
import { contentHash } from '@core/util/hash';
import { isErr, throwOnErr, toHybridError } from '@core/util/maybeResult';
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

class UploadDraftAttachmentError extends Error {
  constructor(
    message: string,
    opts: { cause?: unknown },
    public context: { attachmentID: string; file: File }
  ) {
    super(message, { cause: opts.cause });
  }
}

export const useUploadDraftAttachmentsMutation = (
  callbacks?: MutationCallbacks<
    UploadDraftAttachmentsReturn,
    Error,
    UploadDraftAttachmentsParams
  >
) => {
  return useMutation(() => ({
    mutationFn: async (params: UploadDraftAttachmentsParams) => {
      const uploadedAttachments = [];

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

        uploadedAttachments.push({
          file: attachment,
          attachmentID: result.attachment_id,
        });

        const uploadedResponse = await uploadToPresignedUrl({
          presignedUrl: result.upload_url,
          sha,
          buffer: arrayBuffer,
          type: result.content_type,
        });

        if (isErr(uploadedResponse)) {
          const err = toHybridError(uploadedResponse);
          throw new UploadDraftAttachmentError(
            err.message,
            { cause: err.code },
            {
              attachmentID: result.attachment_id,
              file: attachment,
            }
          );
        }
      }

      return { attachments: uploadedAttachments };
    },
    ...withCallbacks<
      UploadDraftAttachmentsReturn,
      Error,
      UploadDraftAttachmentsParams
    >(
      {
        async onError(error, variables) {
          if (error instanceof UploadDraftAttachmentError) {
            try {
              await emailClient.removeDraftAttachment({
                draftID: variables.draftID,
                attachmentID: error.context.attachmentID,
              });
            } catch {
              console.error('Unable to remove draft attachment after failure');
            }
          }
          toast.failure('Failed to save attachments');
        },
      },
      callbacks
    ),
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
    ...withCallbacks<void, Error, RemoveDraftAttachmentParams>(
      {
        onError() {
          toast.failure('Failed to remove draft attachment');
        },
      },
      callbacks
    ),
  }));
};
