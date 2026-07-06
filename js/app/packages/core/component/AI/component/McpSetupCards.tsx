import CaretRight from '@phosphor-icons/core/bold/caret-right-bold.svg?component-solid';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import { cn, PillButton } from '@ui';
import { createSignal, For, type JSXElement, Show } from 'solid-js';
import {
  CLI_COMMANDS,
  MACRO_MCP_CONFIG,
  MACRO_MCP_URL,
  WEB_CLIENTS,
} from './mcpConstants';
import { useClipboardCopy } from './useClipboardCopy';

/** Narrow, borderless pill — matches the empty-state secondary button. */
function CopyButton(props: {
  copyKey: string;
  copyValue: string;
  copiedKey: () => string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const isCopied = () => props.copiedKey() === props.copyKey;
  return (
    <PillButton
      tone="subtle"
      class="shrink-0 text-xs"
      onClick={() => props.onCopy(props.copyKey, props.copyValue)}
    >
      {isCopied() ? (
        <>
          <CheckIcon class="size-3.5" />
          Copied
        </>
      ) : (
        <>
          <ClipboardIcon class="size-3.5" />
          Copy
        </>
      )}
    </PillButton>
  );
}

function CollapsibleCard(props: {
  label: string;
  hint?: string;
  copyKey: string;
  copyValue: string;
  copiedKey: () => string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="overflow-hidden rounded-md border border-edge-muted bg-surface/70">
      <button
        type="button"
        class="flex items-center gap-2 w-full px-4 py-2 text-left"
        aria-expanded={expanded()}
        onClick={() => setExpanded((v) => !v)}
      >
        <CaretRight
          class="size-3 shrink-0 text-ink-muted transition-transform"
          classList={{ 'rotate-90': expanded() }}
        />
        <span class="text-sm text-ink-muted truncate">{props.label}</span>
      </button>
      <Show when={expanded()}>
        <div class="border-t border-edge-muted flex flex-col">
          <Show when={props.hint}>
            <div class="px-4 pt-3 text-xs text-ink-extra-muted">
              {props.hint}
            </div>
          </Show>
          <div class="flex items-start justify-between gap-3 px-4 py-3">
            <pre class="flex-1 min-w-0 overflow-x-auto text-[12px]/5 text-ink select-text cursor-text whitespace-pre-wrap break-all">
              <code>{props.copyValue}</code>
            </pre>
            <CopyButton
              copyKey={props.copyKey}
              copyValue={props.copyValue}
              copiedKey={props.copiedKey}
              onCopy={props.onCopy}
            />
          </div>
        </div>
      </Show>
    </div>
  );
}

/** A single borderless row: label (+ optional hint) and a copy button. */
function FlatRow(props: {
  label: string;
  hint?: string;
  copyKey: string;
  copyValue: string;
  copiedKey: () => string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div class="flex items-center gap-3 rounded-md py-1.5 pr-1 pl-0">
      <div class="flex min-w-0 flex-col">
        <span class="text-sm text-ink">{props.label}</span>
        <Show when={props.hint}>
          <span class="truncate text-xs text-ink-extra-muted">
            {props.hint}
          </span>
        </Show>
      </div>
      <span class="flex-1" />
      <CopyButton
        copyKey={props.copyKey}
        copyValue={props.copyValue}
        copiedKey={props.copiedKey}
        onCopy={props.onCopy}
      />
    </div>
  );
}

type Row = {
  label: string;
  hint?: string;
  copyKey: string;
  copyValue: string;
};

const ROWS: Row[] = [
  ...CLI_COMMANDS.map((c) => ({
    label: c.label,
    copyKey: c.key,
    copyValue: c.command,
  })),
  ...WEB_CLIENTS.map((c) => ({
    label: c.label,
    hint: c.hint,
    copyKey: c.key,
    copyValue: MACRO_MCP_URL,
  })),
  { label: 'IDE', copyKey: 'json', copyValue: MACRO_MCP_CONFIG },
];

export function McpSetupCards(props: {
  class?: string;
  /**
   * Flat, borderless rows instead of bordered collapsible cards. Used in the
   * agents empty state where a lighter, less boxy layout reads better.
   */
  flat?: boolean;
}) {
  const { copiedKey, copy } = useClipboardCopy();

  return (
    <Show
      when={props.flat}
      fallback={
        <div class={cn('w-full max-w-2xl flex flex-col gap-3', props.class)}>
          <CollapsibleList copiedKey={copiedKey} copy={copy} />
        </div>
      }
    >
      <div class={cn('w-full max-w-2xl flex flex-col', props.class)}>
        <For each={ROWS}>
          {(row) => (
            <FlatRow
              label={row.label}
              hint={row.hint}
              copyKey={row.copyKey}
              copyValue={row.copyValue}
              copiedKey={copiedKey}
              onCopy={copy}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

function CollapsibleList(props: {
  copiedKey: () => string | null;
  copy: (key: string, text: string) => void;
}): JSXElement {
  return (
    <For each={ROWS}>
      {(row) => (
        <CollapsibleCard
          label={row.label}
          hint={row.hint}
          copyKey={row.copyKey}
          copyValue={row.copyValue}
          copiedKey={props.copiedKey}
          onCopy={props.copy}
        />
      )}
    </For>
  );
}
