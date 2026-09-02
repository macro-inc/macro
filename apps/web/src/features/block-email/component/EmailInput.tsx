import { useEmailContext } from '@block-email/component/EmailContext';
import type {
  ApiDraftOutputDbId,
  ApiMessage,
} from '@service-email/generated/schemas';
import { Layer } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  type Setter,
  Show,
} from 'solid-js';
import { decodeBase64Utf8 } from '../util/decodeBase64';
import { plainTextToHtml } from '../util/plainTextToHtml';
import { BaseInput } from './BaseInput';

interface EmailInputProps {
  replyingTo: Accessor<ApiMessage | undefined>;
  draft?: ApiMessage;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
  unframed?: boolean;
  mobileDrawer?: {
    onClose: () => void;
  };
}

export function EmailInput(props: EmailInputProps) {
  const ctx = useEmailContext();

  // The seed identity of this composer: which version of which draft it
  // mounts from. When the server sends a newer save of that draft (a thread
  // opened from a cached snapshot revalidates, or the draft was edited on
  // another device), the key changes and the input remounts, seeding from
  // the newer draft through the ordinary mount path — but only until the
  // user engages with the composer. From then on the mounted instance is
  // authoritative (later fetches are typically echoes of its own saves), so
  // the key latches and the input never remounts underneath the user.
  const [engaged, setEngaged] = createSignal(false);
  const seedKey = createMemo<string>((prev) =>
    engaged() && prev !== undefined
      ? prev
      : props.draft
        ? `${props.draft.db_id}:${props.draft.updated_at}`
        : 'no-draft'
  );

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
      <Show when={seedKey()} keyed>
        {(seed) => (
          <Layer depth={props.mobileDrawer ? 0 : 2}>
            <BaseInput
              replyingTo={props.replyingTo}
              draft={props.draft}
              preloadedHtml={draftHTML()}
              formSeed={seed}
              onEngaged={() => setEngaged(true)}
              sideEffectOnSend={afterSend}
              onMarkDone={ctx.archiveThread}
              setShowReply={props.setShowReply}
              markdownDomRef={props.markdownDomRef}
              unframed={props.unframed}
              mobileDrawer={props.mobileDrawer}
              isEditingExisting={
                props.replyingTo() == null && props.draft != null
              }
            />
          </Layer>
        )}
      </Show>
    </Show>
  );
}
