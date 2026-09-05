import { toast } from '@core/component/Toast/Toast';
import { contentHash } from '@core/util/hash';
import { throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { emailClient } from '@service-email/client';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { useMutation } from '@tanstack/solid-query';

type UploadDraftAttachmentsParams = {
  draftID: string;
  attachments: File[];
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
  /**
   * Called as soon as the attachment record exists, before the content upload.
   * Callers must record the id here rather than after the mutation settles --
   * the content upload can take a long time, and a debounced draft save that
   * still sees the file without an id would add it to the draft a second time.
   */
  onAttachmentAdded?: (file: File, attachmentID: string) => void;
  /**
   * Called when the content upload fails, once its attachment record has been
   * confirmed removed from the draft, so the file becomes eligible for a
   * retry. Not called when the removal itself fails -- retrying a file whose
   * record survived would duplicate it on the draft.
   */
  onAttachmentUploadFailed?: (file: File) => void;
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
  callbacks?: MutationCallbacks<void, Error, UploadDraftAttachmentsParams>
) => {
  return useMutation(() => ({
    mutationFn: async (params: UploadDraftAttachmentsParams) => {
      for (const attachment of params.attachments) {
        const arrayBuffer = await attachment.arrayBuffer();
        const sha = await contentHash(arrayBuffer);

        const result = await throwOnErr(
          async () =>
            await emailClient.addDraftAttachment(
              {
                draftID: params.draftID,
                attachment: {
                  file_name: attachment.name,
                  size: attachment.size,
                  sha,
                },
              },
              params.linkId
            )
        );

        params.onAttachmentAdded?.(attachment, result.attachment_id);

        // Any content-upload failure must become an UploadDraftAttachmentError
        // so onError removes the record and clears the id -- a plain throw from
        // the fetch (network drop, abort) would otherwise leave the id in
        // place and the broken record would never be retried.
        let uploadedResponse: Awaited<ReturnType<typeof uploadToPresignedUrl>>;
        try {
          uploadedResponse = await uploadToPresignedUrl({
            presignedUrl: result.upload_url,
            sha,
            buffer: arrayBuffer,
            type: result.content_type,
          });
        } catch (cause) {
          throw new UploadDraftAttachmentError(
            'Upload failed',
            { cause },
            {
              attachmentID: result.attachment_id,
              file: attachment,
            }
          );
        }

        if (uploadedResponse.isErr()) {
          const uploadError = uploadedResponse.error[0] ?? {
            code: 'SERVER_ERROR',
            message: 'Upload failed',
          };
          throw new UploadDraftAttachmentError(
            uploadError.message,
            { cause: uploadError.code },
            {
              attachmentID: result.attachment_id,
              file: attachment,
            }
          );
        }
      }
    },
    ...withCallbacks<void, Error, UploadDraftAttachmentsParams>(
      {
        async onError(error, variables) {
          if (error instanceof UploadDraftAttachmentError) {
            try {
              await throwOnErr(
                async () =>
                  await emailClient.removeDraftAttachment(
                    {
                      draftID: variables.draftID,
                      attachmentID: error.context.attachmentID,
                    },
                    variables.linkId
                  )
              );
              variables.onAttachmentUploadFailed?.(error.context.file);
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
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
};

export const useRemoveDraftAttachmentMutation = (
  callbacks?: MutationCallbacks<void, Error, RemoveDraftAttachmentParams>
) => {
  return useMutation(() => ({
    mutationFn: async (params: RemoveDraftAttachmentParams) => {
      await throwOnErr(
        async () =>
          await emailClient.removeDraftAttachment(
            {
              draftID: params.draftID,
              attachmentID: params.attachmentID,
            },
            params.linkId
          )
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

type AddForwardedAttachmentsParams = {
  draftID: string;
  attachments: { attachmentID: string }[];
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
};

export const useAddForwardedAttachmentsMutation = (
  callbacks?: MutationCallbacks<void, Error, AddForwardedAttachmentsParams>
) => {
  return useMutation(() => ({
    mutationFn: async (params: AddForwardedAttachmentsParams) => {
      for (const att of params.attachments) {
        await throwOnErr(
          async () =>
            await emailClient.addForwardedAttachment(
              {
                draftID: params.draftID,
                attachmentID: att.attachmentID,
              },
              params.linkId
            )
        );
      }
    },
    ...withCallbacks<void, Error, AddForwardedAttachmentsParams>(
      {
        onError() {
          toast.failure('Failed to add forwarded attachments');
        },
      },
      callbacks
    ),
  }));
};

type RemoveForwardedAttachmentParams = {
  draftID: string;
  attachmentID: string;
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
};

export const useRemoveForwardedAttachmentMutation = (
  callbacks?: MutationCallbacks<void, Error, RemoveForwardedAttachmentParams>
) => {
  return useMutation(() => ({
    mutationFn: async (params: RemoveForwardedAttachmentParams) => {
      await throwOnErr(
        async () =>
          await emailClient.removeForwardedAttachment(
            {
              draftID: params.draftID,
              attachmentID: params.attachmentID,
            },
            params.linkId
          )
      );
    },
    ...withCallbacks<void, Error, RemoveForwardedAttachmentParams>(
      {
        onError() {
          toast.failure('Failed to remove forwarded attachment');
        },
      },
      callbacks
    ),
  }));
};
