import { For, type Signal } from 'solid-js';

export type Source = 'chat' | 'channel' | 'document' | 'email' | 'everything';

const SOURCE_LABELS: Record<Source, string> = {
  everything: 'Everything',
  chat: 'Chat',
  channel: 'Channel',
  document: 'Document',
  email: 'Email',
};

export function SourceSelector(props: { sources: Signal<Source> }) {
  const [source, setSource] = props.sources;

  return (
    <div>
      <div class="relative flex gap-1 text-xs p-1">
        <For each={Object.entries(SOURCE_LABELS)}>
          {([src, label]) => (
            <button
              onClick={() => setSource(src as any)}
              class={`px-2 py-0.5 border-1 border-accent text-s border-0.5 ${source() === (src as any) ? 'bg-accent text-page' : 'hover:text-page text-ink-muted hover:bg-accent hover:border-accent border-ink-muted'}`}
            >
              {label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
