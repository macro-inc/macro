import { decodeBase64Utf8 } from '@app/features/email-compose/core/decode-base64';
import { plainTextToHtml } from '@app/features/email-compose/core/plain-text-to-html';
import { ReplyInputView } from '@app/features/email-compose/views/reply-input';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { Layer } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  type Setter,
  Show,
} from 'solid-js';
import { isPersonalMessage } from '../../email-message/core/is-personal-message';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { useEmailThreadViewContext } from '../context/email-thread-view-context';
import { revealMessageAfterLayout } from '../primitives/scroll-to-message';

interface ThreadReplyInputProps {
  replyingTo: Accessor<EmailMessage | undefined>;
  draft?: EmailMessage;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
  unframed?: boolean;
  mobileDrawer?: {
    onClose: () => void;
  };
}

/** A reply target owns one editor/form lifetime; changing targets must reset the draft latch. */
export function ThreadReplyInput(props: ThreadReplyInputProps) {
  return (
    <Show when={props.replyingTo()?.db_id ?? props.draft?.db_id ?? 'new'} keyed>
      {(_identity) => <ThreadReplyInputSession {...props} />}
    </Show>
  );
}

function ThreadReplyInputSession(props: ThreadReplyInputProps) {
  const ctx = useEmailThreadState();
  const viewContext = useEmailThreadViewContext();

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

  async function afterSend(newMessageId: string | null) {
    // Collapse the input after sending (Gmail-style).
    props.setShowReply?.(false);

    if (!newMessageId) return;

    ctx.messages.setFocused(newMessageId);
    await ctx.query.refetch();
    revealMessageAfterLayout(
      newMessageId,
      ctx.messages.list(),
      ctx.messagesListRef()
    );
  }

  return (
    <Show when={ctx.drafts.initialDraftsSettled()}>
      <Show when={seedKey()} keyed>
        {(seed) => (
          <Layer depth={props.mobileDrawer ? 0 : 2}>
            <ReplyInputView
              context={viewContext.compose}
              session={{
                thread: ctx.thread,
                recipientOptions: ctx.recipientOptions,
                isPersonalReply: () => {
                  const message = props.replyingTo();
                  return (
                    !!message &&
                    isPersonalMessage(
                      message,
                      viewContext.thread.viewerEmail(),
                      ctx.messages.personalSenders()
                    )
                  );
                },
                onDraftRemoved: () => {
                  const id = props.replyingTo()?.db_id;
                  if (id) ctx.drafts.deleteDraftForMessage(id);
                },
                replyRequest: {
                  replyType: () =>
                    ctx.replyRequest.messageId() === props.replyingTo()?.db_id
                      ? ctx.replyRequest.replyType()
                      : undefined,
                  clear: ctx.replyRequest.clear,
                },
                getMarkDoneNavigationTargetId:
                  ctx.getMarkDoneNavigationTargetId,
                exitToThread: (target) => {
                  const id =
                    target === 'last'
                      ? ctx.messages.list().at(-1)?.db_id
                      : ctx.messages.focusedId();
                  if (!id) return false;
                  ctx.messages.setFocused(id);
                  const message = ctx
                    .messagesContainerRef()
                    ?.querySelector<HTMLElement>(
                      `[data-message-body-id="${CSS.escape(id)}"]`
                    );
                  const card = message?.closest<HTMLElement>('[tabindex="0"]');
                  card?.focus();
                  return !!card;
                },
              }}
              sourceEntityId={
                ctx.thread()?.db_id ??
                props.replyingTo()?.thread_db_id ??
                props.draft?.thread_db_id ??
                ''
              }
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
