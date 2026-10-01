import Microphone from '@phosphor/microphone.svg';
import Paperclip from '@phosphor/paperclip.svg';
import X from '@phosphor/x.svg';
import { ComposerSurface, SendButton } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { serializeDemoEditor } from '../../DemoMention';
import { InputActionButton } from './ActionButton';
import { Layout } from './ComposerLayout';

// The actual ChannelInput layout, ComposerSurface, InputActionButton and
// SendAction presentation with a website-local draft instead of app commands.
export function ChannelComposer(props: {
  onSend: (message: string) => void;
  label?: string;
  placeholder?: string;
  leadingAction?: JSX.Element;
  accessory?: JSX.Element;
  agent?: boolean;
  richMentions?: boolean;
}) {
  const [draft, setDraft] = createSignal('');
  const [attachments, setAttachments] = createSignal<string[]>([]);
  let filePicker: HTMLInputElement | undefined;
  let input: HTMLTextAreaElement | HTMLDivElement | undefined;
  const resize = () => {
    if (!input) return;
    input.style.height = '24px';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  };
  onMount(() => {
    const observer = new ResizeObserver(resize);
    if (input?.parentElement) observer.observe(input.parentElement);
    onCleanup(() => observer.disconnect());
  });
  const send = () => {
    if (!draft().trim() && !attachments().length) return;
    props.onSend(
      [draft().trim(), ...attachments().map((name) => `Attached: ${name}`)]
        .filter(Boolean)
        .join('\n')
    );
    setDraft('');
    if (input?.tagName === 'DIV') input.replaceChildren();
    setAttachments([]);
    queueMicrotask(resize);
  };
  return (
    <ComposerSurface class="relative h-auto">
      <input
        type="file"
        multiple
        hidden
        ref={filePicker}
        aria-label="Choose local attachments"
        onChange={(event) => {
          setAttachments(
            Array.from(event.currentTarget.files ?? [], (file) => file.name)
          );
          event.currentTarget.value = '';
        }}
      />
      <Show when={attachments().length}>
        <div class="flex flex-wrap gap-2 px-3 pt-2">
          <For each={attachments()}>
            {(name) => (
              <button
                type="button"
                class="flex items-center gap-2 rounded-lg border border-edge-muted px-2 py-1 text-xs"
                aria-label={`Remove attachment ${name}`}
                onClick={() =>
                  setAttachments((items) =>
                    items.filter((item) => item !== name)
                  )
                }
              >
                <Paperclip class="size-3" />
                {name}
                <X class="size-3" />
              </button>
            )}
          </For>
        </div>
      </Show>
      <Layout
        data-agent-composer={props.agent || undefined}
        oneLineInput={
          !draft().includes('\n') &&
          (input?.tagName === 'DIV'
            ? (input.textContent?.length ?? 0)
            : draft().length) < 70
        }
      >
        <Layout.Body>
          <Layout.Editor>
            <Show
              when={props.richMentions}
              fallback={
                <textarea
                  ref={(element) => {
                    input = element;
                  }}
                  class="mail-channel-input"
                  aria-label={props.label ?? 'Message #launch'}
                  placeholder={props.placeholder ?? 'Message #launch'}
                  rows={1}
                  value={draft()}
                  onInput={(e) => {
                    setDraft(e.currentTarget.value);
                    queueMicrotask(resize);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
              }
            >
              <div
                ref={(element) => {
                  input = element;
                }}
                class="mail-channel-input demo-mention-editor"
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label={props.label ?? 'Message #launch'}
                data-placeholder={props.placeholder ?? 'Message #launch'}
                onInput={(event) => {
                  setDraft(serializeDemoEditor(event.currentTarget));
                  queueMicrotask(resize);
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  const selection = window.getSelection();
                  if (!selection?.rangeCount) return;
                  const range = selection.getRangeAt(0);
                  if (
                    !event.currentTarget.contains(range.commonAncestorContainer)
                  )
                    return;
                  range.deleteContents();
                  const text = document.createTextNode(
                    event.clipboardData?.getData('text/plain') ?? ''
                  );
                  range.insertNode(text);
                  range.setStartAfter(text);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);
                  event.currentTarget.dispatchEvent(
                    new InputEvent('input', {
                      bubbles: true,
                      inputType: 'insertFromPaste',
                    })
                  );
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.isComposing
                  ) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
            </Show>
          </Layout.Editor>
        </Layout.Body>
        <Layout.ActionsLeft>
          {props.leadingAction ?? (
            <InputActionButton
              label="Attach files"
              onClick={() => filePicker?.click()}
            >
              <Paperclip />
            </InputActionButton>
          )}
        </Layout.ActionsLeft>
        <Layout.ActionsRight>
          {props.accessory}
          <InputActionButton label="Dictation" disabled>
            <Microphone />
          </InputActionButton>
          <SendButton
            appearance="composer"
            aria-label="Send demo message"
            data-input-action="send"
            disabled={!draft().trim() && !attachments().length}
            onClick={send}
          />
        </Layout.ActionsRight>
      </Layout>
    </ComposerSurface>
  );
}
