/**
 * The exchange a tool call was: the request the agent made and the response
 * it got, each labelled, as JSON lit the way the code gallery lights its
 * snippets, with a copy button per section. The body for a call the fold has
 * no special rendering for - a tool on an MCP server, a harness tool this
 * block does not model - where the chat block would show raw JSON.
 */

import { jsonLanguage } from '@codemirror/lang-json';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';
import Check from '@phosphor/check.svg';
import Copy from '@phosphor/copy.svg';
import { Button } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';

export interface FoldedExchangeProps {
  /** The tool's arguments; `null` or `undefined` when the call reported none. */
  request?: unknown;
  /** The tool's result, when it reported one as JSON. */
  response?: unknown;
  /** The text the tool reported, for a call whose result is not JSON. */
  responseText?: string | null;
  /** Why the call failed, when it did. */
  error?: string | null;
}

/**
 * Above this many characters a payload is shown plain: lighting it would
 * mean a span per token of something nobody reads token by token.
 */
const HIGHLIGHT_LIMIT = 100_000;

type Token = { text: string; class: string };

const highlighter = tagHighlighter([
  { tag: tags.propertyName, class: 'text-cyan' },
  { tag: tags.string, class: 'text-green' },
  { tag: [tags.number, tags.bool, tags.null], class: 'text-orange' },
  {
    tag: [tags.punctuation, tags.bracket, tags.separator],
    class: 'text-ink-extra-muted',
  },
]);

/** The text split into lines of lit tokens, or plain lines past the limit. */
function tokenizeJson(code: string): Token[][] {
  if (code.length > HIGHLIGHT_LIMIT) {
    return code.split('\n').map((line) => [{ text: line, class: '' }]);
  }
  const lines: Token[][] = [[]];
  highlightCode(
    code,
    jsonLanguage.parser.parse(code),
    highlighter,
    (text, classes) => lines[lines.length - 1]!.push({ text, class: classes }),
    () => lines.push([])
  );
  return lines;
}

/**
 * A payload as the text to show and copy: pretty-printed JSON, or - for a
 * result that is one string, which is how a tool reporting prose arrives -
 * the string itself.
 */
export function exchangeText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Whether a payload slot carries anything to show. */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function FoldedExchange(props: FoldedExchangeProps): JSX.Element {
  const responseText = () =>
    present(props.response)
      ? exchangeText(props.response)
      : (props.responseText ?? undefined);
  return (
    <div class="flex flex-col gap-2">
      <Show when={present(props.request)}>
        <Section
          label="Request"
          text={exchangeText(props.request)}
          json={typeof props.request !== 'string'}
        />
      </Show>
      <Show when={responseText()}>
        {(text) => (
          <Section
            label="Response"
            text={text()}
            json={present(props.response) && typeof props.response !== 'string'}
          />
        )}
      </Show>
      <Show when={props.error}>
        {(error) => <Section label="Error" text={error()} failed />}
      </Show>
    </div>
  );
}

function Section(props: {
  label: string;
  text: string;
  /** Light the text as JSON; plain otherwise. */
  json?: boolean;
  /** Read as a failure. */
  failed?: boolean;
}): JSX.Element {
  const lines = createMemo(() => (props.json ? tokenizeJson(props.text) : []));
  return (
    <section
      class="flex min-w-0 flex-col gap-1"
      aria-label={props.label}
      data-exchange-section={props.label.toLowerCase()}
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] font-medium tracking-wide text-ink-extra-muted uppercase">
          {props.label}
        </span>
        <CopyButton
          text={props.text}
          label={`Copy ${props.label.toLowerCase()}`}
        />
      </div>
      <pre
        class="max-h-96 overflow-auto rounded bg-surface p-2 font-mono text-xs whitespace-pre-wrap wrap-break-word"
        classList={{
          'text-failure': props.failed,
          'text-ink-muted': !props.failed,
        }}
      >
        <Show when={props.json} fallback={props.text}>
          <For each={lines()}>
            {(tokens, index) => (
              <>
                <Show when={index() > 0}>{'\n'}</Show>
                <For each={tokens}>
                  {(token) => (
                    <span class={token.class || undefined}>{token.text}</span>
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
      </pre>
    </section>
  );
}

function CopyButton(props: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
    } catch (error) {
      console.error('Failed to copy to clipboard', error);
      return;
    }
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      noTouchResize
      class="shrink-0 text-ink-extra-muted hover:text-ink-muted"
      label={copied() ? 'Copied' : props.label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
    >
      <Show when={copied()} fallback={<Copy />}>
        <Check class="text-success" />
      </Show>
    </Button>
  );
}
