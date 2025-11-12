import type { ToolSet } from '@service-cognition/generated/schemas';
import { For, Show, type Signal } from 'solid-js';

type ToolSetName = ToolSet['type'];
const DROPDOWN_OPTIONS: Record<ToolSetName, string> = {
  none: 'Ask',
  all: 'Agent',
};

export type Source = 'chat' | 'channel' | 'document' | 'email' | 'everything';

const SOURCE_LABELS: Record<Source, string> = {
  everything: 'Everything',
  chat: 'Chat',
  channel: 'Channel',
  document: 'Document',
  email: 'Email',
};

export function ToolsetSelector(props: {
  toolset: Signal<ToolSet>;
  sources: Signal<Source>;
}) {
  const [toolset, setToolset] = props.toolset;
  const [source, setSource] = props.sources;

  return (
    <div class="flex items-center">
      <div class="flex gap-1 text-xs p-1">
        <For each={Object.entries(DROPDOWN_OPTIONS)}>
          {([k, v]) => (
            <button
              onClick={() => setToolset({ type: k as ToolSetName })}
              class={`px-2 py-0.5 border-1 border-accent text-s border-0.5
              ${toolset().type === k ? 'bg-accent text-page' : 'hover:text-page text-ink-muted hover:bg-accent hover:border-accent border-ink-muted'}`}
            >
              {v}
            </button>
          )}
        </For>
      </div>

      <Show when={toolset().type === 'all'}>
        <span class="text-accent font-bold text-sm font-mono">{'<<<'}</span>
      </Show>
      <Show when={toolset().type === 'all'}>
        <div class="relative flex gap-1 text-xs p-1">
          <For each={Object.entries(SOURCE_LABELS)}>
            {([src, label]) => (
              <button
                onClick={() => setSource(src as any)}
                class={`px-2 py-0.5 border-1 border-accent text-s border-0.5
                ${source() === (src as any) ? 'bg-accent text-page' : 'hover:text-page text-ink-muted hover:bg-accent hover:border-accent border-ink-muted'}`}
              >
                {label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
