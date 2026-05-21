import { useEmailContext } from '@block-email/component/EmailContext';
import type {
  ApiDraftOutputDbId,
  ApiMessage,
} from '@service-email/generated/schemas';
import { Layer } from '@ui';
import { type Accessor, createMemo, type Setter, Show } from 'solid-js';
import { decodeBase64Utf8 } from '../util/decodeBase64';
import { plainTextToHtml } from '../util/plainTextToHtml';
import { BaseInput } from './BaseInput';

interface EmailInputProps {
  replyingTo: Accessor<ApiMessage | undefined>;
  draft?: ApiMessage;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
}

export function EmailInput(props: EmailInputProps) {
  const ctx = useEmailContext();

  const draftHTML = createMemo(() => {
    const encoded = props.draft?.body_html_sanitized;
    if (!encoded) {
      const plainText = props.draft?.body_text;
      if (!plainText) return '';
      return plainTextToHtml(plainText);
    }
    const decodedHtml = decodeBase64Utf8(encoded);
    return decodedHtml;
  });

  function afterSend(newMessageId: ApiDraftOutputDbId | null) {
    // Refresh to get the new message
    ctx.query.refetch();

    // Set focus to new message if provided
    if (newMessageId) ctx.messages.setFocused(newMessageId);

    // Collapse the input after sending (Gmail-style).
    props.setShowReply?.(false);
  }

  return (
    <Show when={ctx.drafts.initialDraftsSettled()}>
      <Layer depth={2}>
        <BaseInput
          replyingTo={props.replyingTo}
          draft={props.draft}
          preloadedHtml={draftHTML()}
          sideEffectOnSend={afterSend}
          onMarkDone={ctx.archiveThread}
          setShowReply={props.setShowReply}
          markdownDomRef={props.markdownDomRef}
          isEditingExisting={props.replyingTo() == null && props.draft != null}
        />
      </Layer>
    </Show>
  );
}
