import type {
  MessageToSendDbId,
  MessageWithBodyReplyless,
} from '@service-email/generated/schemas';
import { type Accessor, createMemo, type Setter, Show } from 'solid-js';
import { produce } from 'solid-js/store';
import { decodeBase64Utf8 } from '../util/decodeBase64';
import { BaseInput } from './BaseInput';
import { useEmailContext } from './EmailContext';

interface EmailInputProps {
  replyingTo: Accessor<MessageWithBodyReplyless>;
  draft?: MessageWithBodyReplyless;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
}

export function EmailInput(props: EmailInputProps) {
  const ctx = useEmailContext();

  const draftHTML = createMemo(() => {
    const encoded = props.draft?.body_html_sanitized;
    if (!encoded) return '';
    const decodedHtml = decodeBase64Utf8(encoded);
    return decodedHtml;
  });

  const draftContainsAppendedReply = createMemo(() => {
    if (!draftHTML()) return false;
    return (
      new DOMParser()
        .parseFromString(draftHTML(), 'text/html')
        .body.querySelector('div.macro_quote') !== null
    );
  });

  function afterSend(newMessageId: MessageToSendDbId | null) {
    const resource = ctx.threadMessagesResource();
    if (!resource) return;

    // Delete the draft from our store
    const parentId = props.replyingTo()?.db_id?.toString();
    if (parentId) {
      ctx.setMessageDbIdToDraftChildren(
        produce((state) => {
          delete state[parentId];
        })
      );
    }

    // Refresh to get the new message
    resource.refresh();

    // Set focus to new message if provided
    if (newMessageId) ctx.setFocusedMessageId(newMessageId);
  }

  return (
    <Show when={props.draft || props.replyingTo}>
      <BaseInput
        replyingTo={props.replyingTo}
        draft={props.draft}
        preloadedHtml={draftHTML()}
        draftContainsAppendedReply={draftContainsAppendedReply()}
        sideEffectOnSend={afterSend}
        setShowReply={props.setShowReply}
        markdownDomRef={props.markdownDomRef}
      />
    </Show>
  );
}
