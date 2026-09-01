import CaretRight from '@phosphor-icons/core/bold/caret-right-bold.svg?component-solid';
import { CopyButton, cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  CLI_COMMANDS,
  MACRO_MCP_CONFIG,
  MACRO_MCP_URL,
  WEB_CLIENTS,
} from './mcpConstants';

function CollapsibleCard(props: {
  label: string;
  hint?: string;
  copyValue: string;
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
            <CopyButton text={props.copyValue} labeled class="shrink-0" />
          </div>
        </div>
      </Show>
    </div>
  );
}

export function McpSetupCards(props: { class?: string }) {
  return (
    <div class={cn('w-full max-w-2xl flex flex-col gap-3', props.class)}>
      <For each={CLI_COMMANDS}>
        {(item) => (
          <CollapsibleCard label={item.label} copyValue={item.command} />
        )}
      </For>

      <For each={WEB_CLIENTS}>
        {(item) => (
          <CollapsibleCard
            label={item.label}
            hint={item.hint}
            copyValue={MACRO_MCP_URL}
          />
        )}
      </For>

      <CollapsibleCard label="IDE" copyValue={MACRO_MCP_CONFIG} />
    </div>
  );
}
