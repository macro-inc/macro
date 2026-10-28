import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, TextField } from '@ui';
import { createEffect, createSignal, For, on, Show, Suspense } from 'solid-js';
import { v7 as newMessageId } from 'uuid';
import { CallChatPanel } from './components/CallChatPanel';
import { useGuestCallChat } from './queries/use-guest-call-chat';

type GuestCallChatProps = {
  callId: string;
  session: { token: string; participantId: string };
  id: string;
  open: boolean;
  onClose: () => void;
};

export default function GuestCallChat(props: GuestCallChatProps) {
  return (
    <Suspense>
      <GuestCallChatContent {...props} />
    </Suspense>
  );
}

function GuestCallChatContent(props: GuestCallChatProps) {
  const chat = useGuestCallChat(
    () => props.callId,
    () => props.session,
    () => props.open
  );
  const [content, setContent] = createSignal('');
  const [error, setError] = createSignal(false);
  let pending: { id: string; content: string } | undefined;
  let input!: HTMLTextAreaElement;
  createEffect(
    on([() => props.open, chat.ready], ([open, ready]) => {
      if (open && ready && !isTouchDevice()) input?.focus();
    })
  );

  async function send() {
    if (!content().trim() || !chat.ready() || chat.sending()) return;
    if (pending?.content !== content())
      pending = { id: newMessageId(), content: content() };
    setError(false);
    try {
      await chat.send(pending);
      pending = undefined;
      setContent('');
      fireAndForget(chat.refresh(), 'meetings');
      if (!isTouchDevice()) input.focus();
    } catch {
      setError(true);
    }
  }

  return (
    <CallChatPanel
      {...props}
      composer={
        <form
          onSubmit={(event) => {
            event.preventDefault();
            fireAndForget(send(), 'meetings');
          }}
        >
          <Show when={error()}>
            <p role="alert" class="mb-2 text-sm text-failure">
              Message could not be sent. Try again.
            </p>
          </Show>
          <TextField
            value={content()}
            onChange={setContent}
            disabled={!chat.ready() || chat.sending()}
          >
            <TextField.TextArea
              ref={input}
              aria-label="Message this call"
              placeholder="Message this call…"
              maxLength={16000}
              rows={3}
              onKeyDown={(event: KeyboardEvent) => {
                if (
                  event.key === 'Enter' &&
                  !isTouchDevice() &&
                  !event.shiftKey &&
                  !event.isComposing
                ) {
                  event.preventDefault();
                  fireAndForget(send(), 'meetings');
                }
              }}
            />
          </TextField>
          <Button
            type="submit"
            class="mt-2"
            disabled={!chat.ready() || chat.sending() || !content().trim()}
          >
            Send
          </Button>
        </form>
      }
    >
      <Show when={chat.loading()}>
        <p role="status" class="text-sm text-ink-muted">
          Loading chat…
        </p>
      </Show>
      <Show when={chat.failed()}>
        <p role="alert" class="text-sm text-ink-muted">
          {chat.denied()
            ? 'Chat is available while you are in this call.'
            : 'Could not load chat.'}
        </p>
        <Button
          type="button"
          onClick={() => fireAndForget(chat.refresh(), 'meetings')}
        >
          Retry
        </Button>
      </Show>
      <Show when={chat.ready() && chat.messages().length === 0}>
        <p class="text-sm text-ink-muted">
          Start the conversation. Messages stay with this call.
        </p>
      </Show>
      <For each={chat.messages()}>
        {(message) => (
          <div class="mb-4">
            <p class="text-sm font-medium">
              {message.name}
              {message.guest ? ' (Guest)' : ''}
              {message.is_you ? ' · You' : ''}
            </p>
            <p class="whitespace-pre-wrap break-words text-sm">
              {message.content}
            </p>
          </div>
        )}
      </For>
    </CallChatPanel>
  );
}
