import { useSplitLayout } from '@app/component/split-layout/layout';
import { Message } from '@core/component/Message';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useDisplayName } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { queryKeys, useQueryClient } from '@macro-entity';
import { logger } from '@observability';
import { emailClient } from '@service-email/client';
import type {
  Attachment,
  MessageWithBodyReplyless,
} from '@service-email/generated/schemas';
import { useUserId } from '@service-gql/client';
import { storageServiceClient } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { EmailAttachmentPill } from './AttachmentPill';
import { useEmailContext } from './EmailContext';
import { EmailInput } from './EmailInput';
import { EmailMessageBody } from './EmailMessageBody';
import { EmailMessageTopBar } from './EmailMessageTopBar';

interface MessageContainerProps {
  message: MessageWithBodyReplyless;
  expandedMessageBodyIds: Record<string, boolean>;
  setExpandedMessageBodyIds: SetStoreFunction<Record<string, boolean>>;
  isFirstMessage: boolean;
  isLastMessage: boolean;
  isFocused: boolean;
  isTarget: boolean;
}

export function MessageContainer(props: MessageContainerProps) {
  const context = useEmailContext();
  const draftChild = createMemo(() => {
    if (!props.message.db_id) return undefined;
    const draft = context.messageDbIdToDraftChildren[props.message.db_id];
    if (!draft) return undefined;
    return draft;
  });

  const [expandedHeader, setExpandedHeader] = createSignal<boolean>(false);
  const [threadAppendMountTarget, setThreadAppendMountTarget] = createSignal<
    HTMLElement | undefined
  >();
  const [showReply, setShowReply] = createSignal<boolean>(false);

  const userId = useUserId();
  const [currentUserName] = useDisplayName(userId());

  const isBodyExpanded = createMemo(() => {
    return props.expandedMessageBodyIds[props.message.db_id ?? ''];
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

  // expand appropriate messages
  createEffect(() => {
    const id = props.message.db_id;
    if (props.isLastMessage && id) {
      props.setExpandedMessageBodyIds(id, true);
    }
    if (isNewMessage() && id) {
      props.setExpandedMessageBodyIds(id, true);
    }
  });

  const { replaceOrInsertSplit } = useSplitLayout();
  const entityQueryClient = useQueryClient();

  const onClickAttachment = async (
    attachment: Attachment,
    fileType?: FileType
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
    });
  };

  return (
    <div class="shrink-0 flex justify-center w-full">
      <div class="macro-message-width w-full">
        <Message
          id={props.message.db_id ?? undefined}
          focused={props.isFocused}
          isFirstMessage={props.isFirstMessage}
          isLastMessage={props.isLastMessage}
          senderId={props.message.from?.email}
          isNewMessage={isNewMessage()}
          isTarget={props.isTarget}
        >
          <Message.TopBar>
            <EmailMessageTopBar
              message={props.message}
              focused={props.isFocused}
              setExpandedMessageBodyIds={props.setExpandedMessageBodyIds}
              isBodyExpanded={isBodyExpanded}
              expandedHeader={expandedHeader}
              setExpandedHeader={setExpandedHeader}
              setFocusedMessageId={context.setFocusedMessageId}
              setShowReply={setShowReply}
              isLastMessage={props.isLastMessage}
            />
          </Message.TopBar>
          <Message.Body>
            <EmailMessageBody
              message={props.message}
              isBodyExpanded={isBodyExpanded}
              setExpandedMessageBody={(id) =>
                props.setExpandedMessageBodyIds(id, true)
              }
              setFocusedMessageId={context.setFocusedMessageId}
            />
          </Message.Body>
          <Show when={visibleAttachments().length > 0}>
            <div class="flex flex-row overflow-x-scroll my-1">
              <For each={visibleAttachments()}>
                {(attachment) => {
                  if (attachment.db_id)
                    return (
                      <EmailAttachmentPill
                        attachment={attachment}
                        onClick={onClickAttachment}
                      />
                    );
                }}
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
            shouldShowThreadAppendInput={createSignal(true)[0]}
            setThreadAppendMountTarget={(el) => setThreadAppendMountTarget(el)}
          >
            <Message.TopBar name={currentUserName()} />
            <div class="h-4" />
          </Message>
          <Portal mount={threadAppendMountTarget()}>
            <EmailInput
              replyingTo={() => props.message}
              setShowReply={setShowReply}
              draft={draftChild()}
            />
          </Portal>
        </Show>
      </div>
    </div>
  );
}
