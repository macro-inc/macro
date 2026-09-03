import { tsxLanguage } from '@codemirror/lang-javascript';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

type Token = { text: string; classes: string };

/**
 * Highlights TSX with the same Lezer grammar CodeMirror uses, but statically —
 * the gallery renders many snippets per page and none of them are editable, so
 * spinning up editor instances would be pure overhead.
 */
function tokenizeLines(code: string): Token[][] {
  const lines: Token[][] = [[]];
  const push = (text: string, classes: string) => {
    lines[lines.length - 1]!.push({ text, classes });
  };

  try {
    highlightCode(
      code,
      tsxLanguage.parser.parse(code),
      classHighlighter,
      push,
      () => lines.push([])
    );
  } catch {
    // A snippet that fails to parse is still worth reading unhighlighted.
    return code.split('\n').map((line) => [{ text: line, classes: '' }]);
  }

  return lines;
}

function CopyButton(props: { code: string }) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const copy = async () => {
    await navigator.clipboard.writeText(props.code);
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      label={copied() ? 'Copied' : 'Copy code'}
      onClick={copy}
    >
      <Show when={copied()} fallback={<CopyIcon />}>
        <CheckIcon class="text-success" />
      </Show>
    </Button>
  );
}

export function CodeBlock(props: {
  code: string;
  class?: string;
  /** Hides the gutter for one-liners like an import statement. */
  compact?: boolean;
}) {
  const lines = createMemo(() => tokenizeLines(props.code));

  return (
    <div
      class={cn(
        'group/code relative bg-inset border border-edge-muted rounded-md overflow-hidden',
        props.class
      )}
    >
      <div class="absolute right-1 top-1 opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
        <CopyButton code={props.code} />
      </div>
      <pre class="overflow-x-auto p-3 text-xs leading-5 font-mono text-ink">
        <code>
          <For each={lines()}>
            {(tokens, index) => (
              <div class="flex">
                <Show when={!props.compact}>
                  <span
                    aria-hidden="true"
                    class="select-none shrink-0 w-8 pr-3 text-right text-ink-extra-muted"
                  >
                    {index() + 1}
                  </span>
                </Show>
                <span class="min-w-0">
                  <For each={tokens}>
                    {(token) => <span class={token.classes}>{token.text}</span>}
                  </For>
                  {/* Keeps empty lines from collapsing to zero height. */}
                  <Show when={tokens.length === 0}>{'​'}</Show>
                </span>
              </div>
            )}
          </For>
        </code>
      </pre>
    </div>
  );
}
