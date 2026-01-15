import { useSplitLayout } from '@app/component/split-layout/layout';
import { EmailAttachmentPill } from '@block-email/component/AttachmentPill';
import { CollapsedMessage } from '@block-email/component/CollapsedMessage';
import { useEmailContext } from '@block-email/component/EmailContext';
import { EmailInput } from '@block-email/component/EmailInput';
import { EmailMessageBody } from '@block-email/component/EmailMessageBody';
import { EmailMessageTopBar } from '@block-email/component/EmailMessageTopBar';
import { isMessageFromCurrentUser } from '@block-email/util/emailUser';
import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { ImagePreview } from '@core/component/ImagePreview';
import { Message } from '@core/component/Message';
import { toast } from '@core/component/Toast/Toast';
import { VideoPreview } from '@core/component/VideoPreview';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { tryMacroId, useDisplayName } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { queryKeys, useQueryClient } from '@macro-entity';
import { logger } from '@observability';
import { emailClient } from '@service-email/client';
import type {
  Attachment,
  MessageWithBodyReplyless,
} from '@service-email/generated/schemas';
import { useEmail, useUserId } from '@service-gql/client';
import { storageServiceClient } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Portal } from 'solid-js/web';

interface MessageContainerProps {
  message: MessageWithBodyReplyless;
  isFirstMessage: boolean;
  isLastMessage: boolean;
  isFocused: boolean;
  isTarget: boolean;
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
  const [threadAppendMountTarget, setThreadAppendMountTarget] = createSignal<
    HTMLElement | undefined
  >();
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
  };

  const userId = useUserId();
  const currentUserEmail = useEmail();
  const [currentUserName] = useDisplayName(tryMacroId(userId() ?? ''));

  const isFromCurrentUser = createMemo(() =>
    isMessageFromCurrentUser(props.message, currentUserEmail())
  );

  const isBodyExpanded = createMemo(() => {
    return context.messages.isBodyExpanded(props.message.db_id ?? '');
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

  createEffect(() => {
    const id = props.message.db_id;
    if (props.isLastMessage && id) {
      context.messages.setExpandedBodyId(id, true);
    }
    if (isNewMessage() && id) {
      context.messages.setExpandedBodyId(id, true);
    }
  });

  const { replaceOrInsertSplit } = useSplitLayout();
  const entityQueryClient = useQueryClient();

  const onClickAttachment = async (
    attachment: Attachment,
    fileType: FileType | undefined
  ) => {
    const dbId = attachment.db_id;
    if (!dbId) return;
    const response = await emailClient.getOrCreateAttachmentDocumentId({
      id: dbId,
    });
    if (isErr(response)) {
      toast.failure('Failed to get attachment. Please try again.');
      return logger.error('Failed to get or create attachment document id', {
        error: new Error(
          'Failed to get or create attachment document id: ' + response[0]
        ),
      });
    }
    const { document_id } = response[1];

    const maybeDocumentMetadata =
      await storageServiceClient.getDocumentMetadata({
        documentId: document_id,
      });
    if (isErr(maybeDocumentMetadata)) {
      toast.failure('Failed to get attachment. Please try again.');
      return logger.error(
        'Failed to get or create attachment document metadata',
        {
          error: new Error(
            'Failed to get or create attachment document metadata: ' +
              maybeDocumentMetadata[0]
          ),
        }
      );
    }

    entityQueryClient.invalidateQueries({
      queryKey: queryKeys.all.dss,
    });

    const blockName = fileType ? fileTypeToBlockName(fileType) : 'unknown';
    replaceOrInsertSplit({
      type: blockName,
      id: document_id,
    })?.activate?.();
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
        <div class="macro-message-width w-full">
          <Message
            id={props.message.db_id ?? undefined}
            focused={props.isFocused}
            isFirstMessage={props.isFirstMessage}
            isLastMessage={props.isLastMessage}
            senderId={
              isFromCurrentUser() ? userId() : props.message.from?.email
            }
            isNewMessage={isNewMessage()}
            isTarget={props.isTarget}
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
              />
            </Message.Body>
            {/* Image attachments */}
            <Show when={imageAttachmentsWithSfs().length > 0}>
              <Switch>
                <Match when={imageAttachmentsWithSfs().length === 1}>
                  <div class="max-w-[400px] w-fit mt-2">
                    <ImagePreview
                      image={{
                        id: imageAttachmentsWithSfs()[0].sfs_id!,
                      }}
                      variant="dynamic"
                    />
                  </div>
                </Match>
                <Match when={imageAttachmentsWithSfs().length > 1}>
                  <div class="flex flex-wrap gap-2 mt-2">
                    <ImageGalleryPreview
                      images={imageAttachmentsWithSfs().map((a) => ({
                        id: a.sfs_id!,
                      }))}
                      variant="dynamic"
                      attachmentIds={imageAttachmentsWithSfs().map(
                        (a) => a.db_id!
                      )}
                    />
                  </div>
                </Match>
              </Switch>
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
          </Message>
          <Show when={(showReply() || draftChild()) && !props.isLastMessage}>
            <Message
              focused={false}
              unfocusable
              senderId={userId()}
              isFirstMessage={false}
              isLastMessage={false}
              threadDepth={1}
              isFirstInThread
              isLastInThread
              shouldShowThreadAppendInput
              setThreadAppendMountTarget={(el) =>
                setThreadAppendMountTarget(el)
              }
            >
              <Message.TopBar name={currentUserName()} />
              <div class="h-4" />
            </Message>
            <Show when={context.permissions().isOwner}>
              <Portal mount={threadAppendMountTarget()}>
                <EmailInput
                  replyingTo={() => props.message}
                  setShowReply={setShowReply}
                  draft={draftChild()}
                />
              </Portal>
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  );
}
