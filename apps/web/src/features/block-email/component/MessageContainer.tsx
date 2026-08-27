import { EmailAttachmentPill } from '@block-email/component/AttachmentPill';
import { CollapsedMessage } from '@block-email/component/CollapsedMessage';
import { useEmailContext } from '@block-email/component/EmailContext';
import { EmailInput } from '@block-email/component/EmailInput';
import { EmailMessageBody } from '@block-email/component/EmailMessageBody';
import { EmailMessageTopBar } from '@block-email/component/EmailMessageTopBar';
import { getSenderMacroId } from '@block-email/util/emailUser';
import { revealMessageAfterLayout } from '@block-email/util/scrollToMessage';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { FloatingInputLoader } from '@core/component/FloatingInputLoader';
import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { VideoPreview } from '@core/component/VideoPreview';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Telemetry } from '@macro-inc/observability';
import { refetchSoupEntity } from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
import type { ApiMessage, Attachment } from '@service-email/generated/schemas';
import { storageServiceClient } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { BottomReplyButtons } from './BottomReplyButtons';

interface MessageContainerProps {
  message: ApiMessage;
  isFirstMessage: boolean;
  isLastMessage: boolean;
  isFocused: boolean;
  isExpanded: boolean;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
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

  const showInlineReplyInput = createMemo(() => {
    if (isTouchDevice()) return false;
    if (!props.isLastMessage) return showReply() || !!draftChild();
    return context.messages.bottomReplyOpen() || !!draftChild();
  });

  const showDesktopLastReplyControls = createMemo(
    () =>
      props.isLastMessage &&
      !!props.message.db_id &&
      !isTouchDevice() &&
      context.drafts.initialDraftsSettled()
  );

  const showInlineReplyArea = createMemo(
    () =>
      context.permissions().isOwner &&
      (showInlineReplyInput() || showDesktopLastReplyControls())
  );

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

  const senderIconProps = createMemo<UserIconProps>(() => {
    const senderId = senderMacroId();
    const photoUrl = props.message.from?.photo_url ?? undefined;
    if (senderId) return { id: senderId, photoUrl };
    return { email: props.message.from?.email ?? '', photoUrl };
  });

  const isBodyExpanded = createMemo(() => {
    return props.isExpanded;
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
      return Telemetry.error(
        new Error(
          'Failed to get or create attachment document id: ' + response.error
        )
      );
    }
    const { document_id } = response.value;

    const maybeDocumentMetadata =
      await storageServiceClient.getDocumentMetadata({
        documentId: document_id,
      });
    if (maybeDocumentMetadata.isErr()) {
      toast.failure('Failed to get attachment. Please try again.');
      return Telemetry.error(
        new Error(
          'Failed to get or create attachment document metadata: ' +
            maybeDocumentMetadata.error
        )
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
    const messageId = props.message.db_id;
    if (!messageId) return;
    context.messages.setExpandedBodyId(messageId, true);
    context.messages.setFocused(messageId);
    revealMessageAfterLayout(
      messageId,
      context.messages.list(),
      context.messagesListRef()
    );
  };

  return (
    <Show
      when={isBodyExpanded()}
      fallback={
        <CollapsedMessage
          message={props.message}
          isFocused={props.isFocused}
          onClick={handleExpand}
          onFocus={() => {
            if (props.message.db_id) {
              context.messages.setFocused(props.message.db_id);
            }
          }}
        />
      }
    >
      {/* Expanded message view */}
      <div class="shrink-0 flex justify-center w-full">
        <div class="macro-message-width macro-message-padding w-full">
          <div
            class="relative p-4 border bg-message macro-thread-card-outdent"
            style={{ '--user-icon-width': '1rem' }}
            classList={{
              'border-rail': props.isFocused,
              'border-edge-muted': !props.isFocused,
              'z-1': props.isFocused,
              'shadow-md': props.isFocused,
              'shadow-drop-shadow': props.isFocused,
            }}
            data-message-body-id={props.message.db_id}
            tabIndex={0}
          >
            <div class="flex flex-col min-w-0 gap-2 overflow-hidden">
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
                avatar={
                  <div class="shrink-0 flex justify-center items-center size-6">
                    <UserIcon
                      {...senderIconProps()}
                      isDeleted={false}
                      size="fill"
                      suppressClick={true}
                    />
                  </div>
                }
              />
              <div class="ph-no-capture text-sm text-ink pr-4">
                <EmailMessageBody
                  message={props.message}
                  personalSenders={context.messages.personalSenders}
                  isBodyExpanded={isBodyExpanded}
                  setExpandedMessageBody={(id) =>
                    context.messages.setExpandedBodyId(id, true)
                  }
                  setFocusedMessageId={context.messages.setFocused}
                  isFirstMessageInThread={props.isFirstMessage}
                  isFocused={props.isFocused}
                />
              </div>
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
            </div>
            <Show when={showInlineReplyArea()}>
              <div class="relative -mx-4 mb-0 border-t border-ink/20 mt-4">
                <Show when={props.isLastMessage && !isTouchDevice()}>
                  <FloatingInputLoader
                    isLoading={context.query.isFetching}
                    loadingText="Loading messages"
                  />
                </Show>
                <div class="px-4">
                  <Switch>
                    <Match when={showInlineReplyInput()}>
                      <EmailInput
                        replyingTo={() => props.message}
                        setShowReply={setShowReply}
                        draft={draftChild()}
                        markdownDomRef={
                          props.isLastMessage ? props.markdownDomRef : undefined
                        }
                        unframed
                      />
                    </Match>
                    <Match when={props.isLastMessage && !isTouchDevice()}>
                      <BottomReplyButtons lastMessage={props.message} />
                    </Match>
                  </Switch>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
