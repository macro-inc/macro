import CaretRight from '@phosphor/caret-right.svg';
import Clock from '@phosphor/clock.svg';
import Paperclip from '@phosphor/paperclip.svg';
import Trash from '@phosphor/trash.svg';
import { Button, Dropdown, SendButton } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import { homepagePeople } from '../../../core/homepage-demo-people';

/** Email compose/reply-input presentation with local recipients and no transport. */
export function EmailReply(props: {
  to: string;
  onDiscard: () => void;
  onSend: (
    body: string,
    to: string,
    scheduled: string | undefined,
    recipients: { cc?: string; bcc?: string }
  ) => void;
}) {
  const [body, setBody] = createSignal('');
  const [to, setTo] = createSignal(props.to);
  const [expanded, setExpanded] = createSignal(false);
  const [cc, setCc] = createSignal(false);
  const [bcc, setBcc] = createSignal(false);
  const [ccValue, setCcValue] = createSignal('');
  const [bccValue, setBccValue] = createSignal('');
  const [attachments, setAttachments] = createSignal<string[]>([]);
  const [schedule, setSchedule] = createSignal<string>();
  let editor!: HTMLTextAreaElement;
  let picker!: HTMLInputElement;
  onMount(() => editor.focus());
  const send = () => {
    if (!body().trim() || !to().trim()) return;
    props.onSend(
      [body().trim(), ...attachments().map((name) => `Attached: ${name}`)].join(
        '\n'
      ),
      to(),
      schedule(),
      {
        cc: cc() ? ccValue().trim() : undefined,
        bcc: bcc() ? bccValue().trim() : undefined,
      }
    );
  };
  return (
    <div class="sample-email-reply">
      <Show
        when={expanded()}
        fallback={
          <button
            type="button"
            class="sample-reply-summary"
            onClick={() => setExpanded(true)}
          >
            Replying to {to()}
            <CaretRight class="size-3 ml-auto" />
          </button>
        }
      >
        <div class="sample-reply-fields">
          <div>
            <span>From</span>
            <span class="flex items-center gap-2">
              <img
                alt=""
                class="size-5 rounded-full"
                src={homepagePeople.jacob.photo}
              />
              Jacob Beckerman
            </span>
            <Button size="sm" variant="plain" onClick={() => setCc(!cc())}>
              Cc
            </Button>
            <Button size="sm" variant="plain" onClick={() => setBcc(!bcc())}>
              Bcc
            </Button>
          </div>
          <label>
            <span>To</span>
            <input
              aria-label="Reply recipients"
              value={to()}
              onInput={(e) => setTo(e.currentTarget.value)}
            />
          </label>
          <Show when={cc()}>
            <label>
              <span>Cc</span>
              <input
                aria-label="Reply Cc"
                placeholder="Add recipients"
                value={ccValue()}
                onInput={(e) => setCcValue(e.currentTarget.value)}
              />
            </label>
          </Show>
          <Show when={bcc()}>
            <label>
              <span>Bcc</span>
              <input
                aria-label="Reply Bcc"
                placeholder="Add recipients"
                value={bccValue()}
                onInput={(e) => setBccValue(e.currentTarget.value)}
              />
            </label>
          </Show>
        </div>
      </Show>
      <textarea
        ref={editor}
        aria-label="Email reply"
        placeholder="Reply — @mention to share or cc people"
        value={body()}
        onInput={(e) => {
          setBody(e.currentTarget.value);
          e.currentTarget.style.height = '64px';
          e.currentTarget.style.height = `${Math.max(64, e.currentTarget.scrollHeight)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <Show when={attachments().length}>
        <div class="flex gap-2 py-2">
          <For each={attachments()}>
            {(name) => (
              <button
                type="button"
                class="text-xs border border-edge rounded-lg px-2 py-1"
                onClick={() =>
                  setAttachments((files) =>
                    files.filter((file) => file !== name)
                  )
                }
              >
                {name} ×
              </button>
            )}
          </For>
        </div>
      </Show>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label="Reply attachments"
        onChange={(e) =>
          setAttachments(
            Array.from(e.currentTarget.files ?? [], (file) => file.name)
          )
        }
      />
      <div class="flex items-center justify-end gap-1 pt-2">
        <Show when={schedule()}>
          <span class="mr-auto text-xs text-ink-muted">{schedule()}</span>
        </Show>
        <Button
          size="icon-composer"
          variant="plain"
          label="Discard reply"
          onClick={props.onDiscard}
        >
          <Trash />
        </Button>
        <Button
          size="icon-composer"
          variant="plain"
          label="Attach to reply"
          onClick={() => picker.click()}
        >
          <Paperclip />
        </Button>
        <Dropdown modal={false}>
          <Dropdown.Trigger
            size="icon-composer"
            variant="plain"
            aria-label="Choose send time"
          >
            <Clock />
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local">
            <Dropdown.Group>
              <For each={['Send now', 'Tomorrow at 9 AM', 'Monday at 9 AM']}>
                {(option) => (
                  <Dropdown.Item
                    onSelect={() =>
                      setSchedule(option === 'Send now' ? undefined : option)
                    }
                  >
                    {option}
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
        <SendButton
          appearance="composer"
          aria-label={schedule() ? 'Schedule email reply' : 'Send email reply'}
          disabled={!body().trim() || !to().trim()}
          onClick={send}
        />
      </div>
    </div>
  );
}
