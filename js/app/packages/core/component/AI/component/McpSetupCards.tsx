import CaretRight from '@phosphor-icons/core/bold/caret-right-bold.svg?component-solid';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import { Button, cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  CLI_COMMANDS,
  MACRO_MCP_CONFIG,
  MACRO_MCP_URL,
  WEB_CLIENTS,
} from './mcpConstants';
import { useClipboardCopy } from './useClipboardCopy';

function CollapsibleCard(props: {
  label: string;
  hint?: string;
  copyKey: string;
  copyValue: string;
  copiedKey: () => string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const isCopied = () => props.copiedKey() === props.copyKey;

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
            <Button
              variant={isCopied() ? 'base' : 'ghost'}
              size="sm"
              class="shrink-0"
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
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}

export function McpSetupCards(props: { class?: string }) {
  const { copiedKey, copy } = useClipboardCopy();

  return (
    <div class={cn('w-full max-w-2xl flex flex-col gap-3', props.class)}>
      <For each={CLI_COMMANDS}>
        {(item) => (
          <CollapsibleCard
            label={item.label}
            copyKey={item.key}
            copyValue={item.command}
            copiedKey={copiedKey}
            onCopy={copy}
          />
        )}
      </For>

      <For each={WEB_CLIENTS}>
        {(item) => (
          <CollapsibleCard
            label={item.label}
            hint={item.hint}
            copyKey={item.key}
            copyValue={MACRO_MCP_URL}
            copiedKey={copiedKey}
            onCopy={copy}
          />
        )}
      </For>

      <CollapsibleCard
        label="IDE"
        copyKey="json"
        copyValue={MACRO_MCP_CONFIG}
        copiedKey={copiedKey}
        onCopy={copy}
      />
    </div>
  );
}
