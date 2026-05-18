import { useSplitLayout } from '@app/component/split-layout/layout';
import { EmailAttachmentPill } from '@block-email/component/AttachmentPill';
import { CollapsedMessage } from '@block-email/component/CollapsedMessage';
import { useEmailContext } from '@block-email/component/EmailContext';
import { EmailInput } from '@block-email/component/EmailInput';
import { EmailMessageBody } from '@block-email/component/EmailMessageBody';
import { EmailMessageTopBar } from '@block-email/component/EmailMessageTopBar';
import { getSenderMacroId } from '@block-email/util/emailUser';
import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { Message } from '@core/component/Message';
import { toast } from '@core/component/Toast/Toast';
import { VideoPreview } from '@core/component/VideoPreview';
import { fileTypeToBlockName } from '@core/constant/allBlocks';

import { logger } from '@observability';
import { refetchSoupEntity } from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
import type { ApiMessage, Attachment } from '@service-email/generated/schemas';
import { storageServiceClient } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { createMemo, createSignal, For, Show } from 'solid-js';

interface MessageContainerProps {
  message: ApiMessage;
  isFirstMessage: boolean;
  isLastMessage: boolean;
  isFocused: boolean;
  isTarget: boolean;
  isExpanded: boolean;
}

export function MessageContainer(props: MessageContainerProps) {
  const context = useEmailContext();
  const draftChild = createMemo(() => {
    if (!props.message.db_id) return undefined;
    const draft = context.drafts.getDraftForMessage(props.message.db_id);
    if (!draft) return undefined;
    return draft;
  });

  const [expandedHeader, setExpandedHeader] = createSignal<boolean>(false);
  const [showReplyInternal, setShowReplyInternal] =
    createSignal<boolean>(false);

  const showReply = () =>
    showReplyInternal() ||
    context.messages.replyingToMessageId() === props.message.db_id;

  const setShowReply = (value: boolean | ((prev: boolean) => boolean)) => {
    const newValue =
      typeof value === 'function' ? value(showReplyInternal()) : value;
    setShowReplyInternal(newValue);
    if (
      !newValue &&
      context.messages.replyingToMessageId() === props.message.db_id
    ) {
      context.messages.setReplyingToMessageId(undefined);
    }
    // Reply/Reply-All/Forward actions on the last message open the bottom
    // reply input (the inline reply only renders for non-last messages).
    if (props.isLastMessage) {
      context.messages.setBottomReplyOpen(newValue);
    }
  };

  const senderMacroId = createMemo(() => getSenderMacroId(props.message));

  const isBodyExpanded = createMemo(() => {
    return props.isExpanded;
  });

  const isNewMessage = createMemo(() => {
    return (
      props.message.labels.find((l) => l.provider_label_id === 'UNREAD') !==
      undefined
    );
  });

  // Hide attachments that are referenced in inline images
  const inlineContentIds = createMemo(() => {
    const set = new Set<string>();
    const collectFromHtml = (html: string) => {
      const regex = /src=["']cid:([^"']+)["']/gi;
      let match = regex.exec(html);
      while (match !== null) {
        const raw = match[1];
        const normalized = raw.replace(/[<>]/g, '').trim();
        if (normalized) set.add(normalized);
        match = regex.exec(html);
      }
    };
    collectFromHtml(props.message.body_html_sanitized ?? '');
    return set;
  });

  const visibleAttachments = createMemo(() => {
    return props.message.attachments.filter((a) => {
      if (!a.db_id) return false;
      const contentId = a.content_id?.toString();
      if (!contentId) return true;
      const normalized = contentId.replace(/[<>]/g, '').trim();
      return !inlineContentIds().has(normalized);
    });
  });

  const imageAttachmentsWithSfs = createMemo(() => {
    return visibleAttachments().filter(
      (a) => a.mime_type?.startsWith('image/') && a.sfs_id
    );
  });

  const videoAttachmentsWithSfs = createMemo(() => {
    return visibleAttachments().filter(
      (a) => a.mime_type?.startsWith('video/') && a.sfs_id
    );
  });

  const otherAttachments = createMemo(() => {
    return visibleAttachments().filter(
      (a) =>
        !a.sfs_id ||
        (!a.mime_type?.startsWith('image/') &&
          !a.mime_type?.startsWith('video/'))
    );
  });

  const { openWithSplit } = useSplitLayout();
  const draftAttachments = createMemo(() => {
    return props.message.attachments_draft ?? [];
  });

  const forwardedAttachments = createMemo(() => {
    return props.message.attachments_forwarded ?? [];
  });

  const onClickAttachment = async (
    attachment: Attachment,
    fileType: FileType | undefined
  ) => {
    const dbId = attachment.db_id;
    if (!dbId) return;
    const response = await emailClient.getOrCreateAttachmentDocumentId({
      id: dbId,
    });
    if (response.isErr()) {
      toast.failure('Failed to get attachment. Please try again.');
      return logger.error('Failed to get or create attachment document id', {
        error: new Error(
          'Failed to get or create attachment document id: ' + response.error
        ),
      });
    }
    const { document_id } = response.value;

    const maybeDocumentMetadata =
      await storageServiceClient.getDocumentMetadata({
        documentId: document_id,
      });
    if (maybeDocumentMetadata.isErr()) {
      toast.failure('Failed to get attachment. Please try again.');
      return logger.error(
        'Failed to get or create attachment document metadata',
        {
          error: new Error(
            'Failed to get or create attachment document metadata: ' +
              maybeDocumentMetadata.error
          ),
        }
      );
    }

    refetchSoupEntity(document_id, 'document');

    const blockName = fileType ? fileTypeToBlockName(fileType) : 'unknown';
    openWithSplit(
      { type: blockName, id: document_id },
      { preferNewSplit: true }
    );
  };

  const handleExpand = () => {
    if (props.message.db_id) {
      context.messages.setExpandedBodyId(props.message.db_id, true);
      context.messages.setFocused(props.message.db_id);
    }
  };

  return (
    <Show
      when={isBodyExpanded()}
      fallback={
        <CollapsedMessage
          message={props.message}
          isFocused={props.isFocused}
          onClick={handleExpand}
        />
      }
    >
      {/* Expanded message view */}
      <div class="shrink-0 flex justify-center w-full">
        <div class="macro-message-width macro-message-padding w-full">
          <div
            class="relative rounded-lg overflow-hidden pl-1 pr-1.5 py-2 ring-1 ring-inset [&>div]:bg-transparent!"
            classList={{
              'bg-active/60 ring-edge': props.isFocused,
              'bg-ink-muted/[0.025] ring-ink-muted/8': !props.isFocused,
            }}
          >
            <Message
              id={props.message.db_id ?? undefined}
              focused={false}
              isFirstMessage={true}
              isLastMessage={props.isLastMessage}
              senderId={senderMacroId()}
              isNewMessage={isNewMessage()}
              isTarget={props.isTarget}
              hasReplyInputBelow={true}
              hideConnectors
              hasThreadChildren={
                !props.isLastMessage && (showReply() || !!draftChild())
              }
            >
              <Message.TopBar>
                <EmailMessageTopBar
                  message={props.message}
                  focused={props.isFocused}
                  setExpandedBodyId={context.messages.setExpandedBodyId}
                  isBodyExpanded={isBodyExpanded}
                  expandedHeader={expandedHeader}
                  setExpandedHeader={setExpandedHeader}
                  setFocusedMessageId={context.messages.setFocused}
                  setShowReply={setShowReply}
                  isLastMessage={props.isLastMessage}
                  hiddenActions={
                    !context.permissions().isOwner
                      ? ['reply', 'reply-all', 'forward']
                      : undefined
                  }
                />
              </Message.TopBar>
              <Message.Body>
                <EmailMessageBody
                  message={props.message}
                  isBodyExpanded={isBodyExpanded}
                  setExpandedMessageBody={(id) =>
                    context.messages.setExpandedBodyId(id, true)
                  }
                  setFocusedMessageId={context.messages.setFocused}
                  isFirstMessageInThread={props.isFirstMessage}
                  isFocused={props.isFocused}
                />
              </Message.Body>
              {/* Image attachments */}
              <Show when={imageAttachmentsWithSfs().length > 0}>
                <div class="flex flex-wrap gap-2 mt-2">
                  <ImageGalleryPreview
                    images={imageAttachmentsWithSfs().map((a) => ({
                      id: a.sfs_id!,
                    }))}
                    variant="small"
                    attachmentIds={imageAttachmentsWithSfs().map(
                      (a) => a.db_id!
                    )}
                  />
                </div>
              </Show>

              {/* Video attachments */}
              <Show when={videoAttachmentsWithSfs().length > 0}>
                <For each={videoAttachmentsWithSfs()}>
                  {(attachment) => (
                    <VideoPreview id={attachment.sfs_id!} variant="dynamic" />
                  )}
                </For>
              </Show>

              {/* Other attachments (non-media or without sfs_id) */}
              <Show when={otherAttachments().length > 0}>
                <div class="flex flex-row overflow-x-scroll mt-2 gap-2">
                  <For each={otherAttachments()}>
                    {(attachment) => (
                      <EmailAttachmentPill
                        attachment={{
                          fileName: attachment.filename ?? '',
                          mimeType: attachment.mime_type ?? undefined,
                        }}
                        onClick={(fileType) =>
                          onClickAttachment(attachment, fileType)
                        }
                      />
                    )}
                  </For>
                </div>
              </Show>

              {/* Draft attachments */}
              <Show
                when={
                  draftAttachments().length > 0 ||
                  forwardedAttachments().length > 0
                }
              >
                <div class="flex flex-row overflow-x-scroll mt-2 gap-2">
                  <For each={draftAttachments()}>
                    {(attachment) => (
                      <EmailAttachmentPill
                        attachment={{
                          fileName: attachment.file_name,
                          mimeType: attachment.content_type,
                        }}
                      />
                    )}
                  </For>
                  <For each={forwardedAttachments()}>
                    {(attachment) => (
                      <EmailAttachmentPill
                        attachment={{
                          fileName: attachment.filename ?? '',
                          mimeType: attachment.mime_type ?? undefined,
                        }}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Message>
            <Show when={(showReply() || draftChild()) && !props.isLastMessage}>
              <Show when={context.permissions().isOwner}>
                <div class="border-t border-ink-muted/8 -mx-1.5 px-1.5 pt-2 pb-1 [&>*>div]:border-0! [&>*>div]:bg-transparent! [&>*>div]:rounded-none!">
                  <EmailInput
                    replyingTo={() => props.message}
                    setShowReply={setShowReply}
                    draft={draftChild()}
                  />
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
