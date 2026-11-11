import { For } from 'solid-js';

/** The full path list behind a truncated inline summary. */
export function FoldedPathList(props: { paths: string[] }) {
  return (
    <ul class="flex min-w-0 flex-col">
      <For each={props.paths}>
        {(path) => <li class="truncate font-mono">{path}</li>}
      </For>
    </ul>
  );
}
