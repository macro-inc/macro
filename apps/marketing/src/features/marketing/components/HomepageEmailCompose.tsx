import ArrowUp from '@phosphor/arrow-up.svg';
import Paperclip from '@phosphor/paperclip.svg';
import TextAa from '@phosphor/text-aa.svg';
import { Button, ComposerSurface, SendButton } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import { homepagePeople } from '../core/homepage-demo-people';
import {
  createEmailDemoGeneration,
  type EmailDemoToken,
} from '../primitives/createEmailDemoGeneration';
import { HomepageMention } from './HomepageMention';
import './homepage-email-compose.css';

/** A frozen website composer. Addresses, attachments, edits, and sends stay local. */
export default function HomepageEmailCompose(
  props: {
    appChrome?: boolean;
    draft?: { subject: string; to: string; body: string };
    onSend?: (draft: { subject: string; to: string; body: string }) => void;
  } = {}
) {
  const [subject, setSubject] = createSignal(
    props.draft?.subject ?? 'Great meeting you — demo follow-up'
  );
  const [showBcc, setShowBcc] = createSignal(false);
  const [showFormat, setShowFormat] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [attachmentError, setAttachmentError] = createSignal('');
  const [attachments, setAttachments] = createSignal<File[]>([]);
  let root: HTMLDivElement | undefined;
  let body: HTMLDivElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  const [to, setTo] = createSignal(
    props.draft?.to ?? 'Dana Whitfield <dana@example.com>'
  );
  const disposeMentions: Array<() => void> = [];
  onCleanup(() => disposeMentions.forEach((dispose) => dispose()));

  function append(items: EmailDemoToken[]) {
    if (!body) return;
    for (const item of items) {
      let paragraph = body.lastElementChild;
      if (!paragraph || item === '\n') {
        paragraph = document.createElement('p');
        body.append(paragraph);
      }
      if (item === '\n') continue;
      if (typeof item === 'string') {
        const last = paragraph.lastChild;
        if (last?.nodeType === Node.TEXT_NODE) last.textContent += item;
        else paragraph.append(document.createTextNode(item));
      } else {
        const mention = document.createElement('span');
        mention.contentEditable = 'false';
        mention.dataset.documentMention = '';
        paragraph.append(mention);
        disposeMentions.push(
          render(
            () => (
              <HomepageMention
                kind={item.kind}
                label={item.label}
                description={
                  item.kind === 'pdf'
                    ? 'Macro product overview and pricing, shared after the demo.'
                    : 'The setup steps and owners for Dana’s team.'
                }
                href="#email"
              />
            ),
            mention
          )
        );
      }
    }
  }
  const generation = createEmailDemoGeneration(
    () => (props.draft ? undefined : root),
    append
  );
  const generating = () => !props.draft && generation.phase() !== 'complete';
  const send = () => {
    if (props.onSend) {
      if (!subject().trim() || !to().trim() || !body?.innerText.trim()) return;
      props.onSend({ subject: subject(), to: to(), body: body.innerText });
    } else setSent(true);
  };

  function addAttachments(files: File[]) {
    const bytes = [...attachments(), ...files].reduce(
      (total, file) => total + file.size,
      0
    );
    if (bytes >= 18 * 1024 * 1024) {
      setAttachmentError('Total attachments exceed the 18 MB limit.');
      return;
    }
    setAttachmentError('');
    setAttachments((previous) => [...previous, ...files]);
  }

  function format(command: string) {
    body?.focus({ preventScroll: true });
    // Native editing keeps this small, local preview independent of Lexical.
    document.execCommand(command);
  }

  return (
    <div
      ref={root}
      class="workspace-demo portal-scope homepage-email-demo"
      data-theme="dark"
      data-generation={generation.phase()}
      aria-busy={generating()}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === 'Enter' &&
          !generating()
        ) {
          event.preventDefault();
          send();
        }
      }}
    >
      <Dynamic
        component={props.appChrome ? ComposerSurface : 'div'}
        as={props.appChrome ? 'div' : undefined}
        class={
          props.appChrome
            ? 'homepage-email-app-surface'
            : 'homepage-email-surface'
        }
      >
        <div class="homepage-email-fields">
          <div class="homepage-email-row">
            <span class="homepage-email-label">From</span>
            <span class="homepage-email-sender">
              <img
                src={homepagePeople.jacob.photo}
                width="24"
                height="24"
                alt=""
              />
              Jacob Beckerman
            </span>
            <Show when={generating()}>
              <span class="homepage-email-generating" role="status">
                Generating<span aria-hidden="true">…</span>
              </span>
            </Show>
            <Show when={!showBcc()}>
              <button
                type="button"
                class="homepage-email-bcc"
                disabled={generating()}
                onClick={() => setShowBcc(true)}
              >
                Bcc
              </button>
            </Show>
          </div>
          <For each={['To', 'Cc', ...(showBcc() ? ['Bcc'] : [])]}>
            {(label) => (
              <label class="homepage-email-row">
                <span class="homepage-email-label">{label}</span>
                <input
                  aria-label={label}
                  value={
                    label === 'To'
                      ? to()
                      : label === 'Cc'
                        ? 'Julia Westphal <julia@macro.com>'
                        : ''
                  }
                  onInput={(event) => {
                    if (label === 'To') setTo(event.currentTarget.value);
                  }}
                  disabled={generating()}
                  placeholder="Email address"
                />
              </label>
            )}
          </For>
          <label class="homepage-email-row homepage-email-subject">
            <span class="homepage-email-label">Subject</span>
            <input
              aria-label="Subject"
              value={subject()}
              onInput={(event) => setSubject(event.currentTarget.value)}
              disabled={generating()}
              placeholder="Subject"
            />
          </label>
        </div>
        <div class="homepage-email-body-wrap" data-email-demo-body>
          <div
            ref={body}
            class="homepage-email-body"
            contentEditable={!generating()}
            role="textbox"
            aria-label="Email body"
            aria-multiline="true"
            aria-disabled={generating()}
          >
            {props.draft?.body}
          </div>
          <For each={attachments()}>
            {(file) => (
              <div class="homepage-email-attachment">
                <span>{file.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((items) =>
                      items.filter((item) => item !== file)
                    )
                  }
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <Show when={attachmentError()}>
            <p role="alert">{attachmentError()}</p>
          </Show>
          <Show when={sent()}>
            <div class="homepage-email-sent" role="status">
              Sent in this demo.
              <button type="button" onClick={() => setSent(false)}>
                Edit again
              </button>
            </div>
          </Show>
        </div>
        <Show when={showFormat()}>
          <div
            class="homepage-email-format"
            role="toolbar"
            aria-label="Email formatting"
          >
            <For
              each={[
                ['Bold', 'bold'],
                ['Italic', 'italic'],
                ['Underline', 'underline'],
                ['Bullets', 'insertUnorderedList'],
              ]}
            >
              {([label, command]) => (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format(command)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <div
          class={
            props.appChrome
              ? 'homepage-email-app-toolbar'
              : 'homepage-email-toolbar'
          }
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Choose attachments"
            onChange={(event) => {
              addAttachments(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = '';
            }}
          />
          <Show
            when={props.appChrome}
            fallback={
              <>
                <button
                  type="button"
                  aria-label="Attach"
                  title="Attach"
                  disabled={generating()}
                  onClick={() => fileInput?.click()}
                >
                  <Paperclip />
                </button>
                <button
                  type="button"
                  aria-label="Format"
                  title="Format"
                  aria-pressed={showFormat()}
                  disabled={generating()}
                  onClick={() => setShowFormat(!showFormat())}
                >
                  <TextAa />
                </button>
                <button
                  type="button"
                  class="homepage-email-send"
                  aria-label="Send email"
                  title="Send email"
                  disabled={generating()}
                  onClick={send}
                >
                  <ArrowUp />
                </button>
              </>
            }
          >
            <Button
              variant="ghost"
              size="icon-composer"
              class="rounded-full"
              aria-label="Attach"
              disabled={generating()}
              onClick={() => fileInput?.click()}
            >
              <Paperclip />
            </Button>
            <Button
              variant="ghost"
              size="icon-composer"
              class="rounded-full"
              aria-label="Format"
              aria-pressed={showFormat()}
              disabled={generating()}
              onClick={() => setShowFormat(!showFormat())}
            >
              <TextAa />
            </Button>
            <SendButton
              data-input-action="send"
              appearance="composer"
              aria-label="Send email"
              disabled={generating()}
              onClick={send}
            />
          </Show>
        </div>
      </Dynamic>
    </div>
  );
}
