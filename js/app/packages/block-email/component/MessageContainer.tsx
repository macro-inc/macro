import { Message } from '@core/component/Message';
import { useDisplayName } from '@core/user';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { useUserId } from '@service-gql/client';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { EmailAttachmentPill } from './AttachmentPill';
import { useEmailContext } from './EmailContext';
import { EmailInput } from './EmailInput';
import { EmailMessageBody } from './EmailMessageBody';
import { EmailMessageTopBar } from './EmailMessageTopBar';

interface MessageContainerProps {
  message: MessageWithBodyReplyless;
  index: Accessor<number>;
  expandedMessageBodyIds: Record<string, boolean>;
  setExpandedMessageBodyIds: SetStoreFunction<Record<string, boolean>>;
}

export function MessageContainer(props: MessageContainerProps) {
  const context = useEmailContext();
  const draftChild = createMemo(
    () => context.messageDbIdToDraftChildren[props.message.db_id ?? '']
  );

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

  const isFocused = createMemo(() => {
    return props.message.db_id === context.focusedMessageId();
  });

  const isFirstMessage = createMemo(() => {
    return props.index() === 0;
  });

  const isLastMessage = createMemo(() => {
    return props.index() === (context.filteredMessages().length ?? 0) - 1;
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
    if (isLastMessage() && id) {
      props.setExpandedMessageBodyIds(id, true);
    }
    if (isNewMessage() && id) {
      props.setExpandedMessageBodyIds(id, true);
    }
  });

  return (
    <div class="macro-message-width w-full">
      <Message
        focused={isFocused()}
        isFirstMessage={isFirstMessage()}
        isLastMessage={isLastMessage()}
        senderId={props.message.from?.email}
        isNewMessage={isNewMessage()}
      >
        <Message.TopBar>
          <EmailMessageTopBar
            message={props.message}
            focused={isFocused()}
            setExpandedMessageBodyIds={props.setExpandedMessageBodyIds}
            isBodyExpanded={isBodyExpanded}
            expandedHeader={expandedHeader}
            setExpandedHeader={setExpandedHeader}
            setFocusedMessageId={context.setFocusedMessageId}
            setShowReply={setShowReply}
            isLastMessage={isLastMessage()}
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
                  return <EmailAttachmentPill attachment={attachment} />;
              }}
            </For>
          </div>
        </Show>
      </Message>
      <Show when={(showReply() || draftChild()) && !isLastMessage()}>
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
          <EmailInput replyingTo={() => props.message} draft={draftChild()} />
        </Portal>
      </Show>
    </div>
  );
}
