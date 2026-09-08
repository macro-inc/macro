import FileText from '@phosphor/file-text.svg';
import { For } from 'solid-js';

export function FoldedPathList(props: { paths: string[] }) {
  return (
    <div class="max-h-64 overflow-auto">
      <For each={props.paths}>
        {(path) => (
          <div class="flex min-h-10 items-center gap-3 border-b border-edge-muted px-4 py-2 last:border-0">
            <FileText class="size-4 shrink-0 text-ink-extra-muted" />
            <span
              class="truncate font-mono text-xs text-ink-muted"
              title={path}
            >
              {path}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
