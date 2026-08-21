import { Tool } from '@core/component/AI/component/tool/Tool';
import FileText from '@phosphor/file-text.svg';
import { For } from 'solid-js';

/** The full path list behind a truncated inline summary. */
export function FoldedPathList(props: { paths: string[] }) {
  return (
    <Tool.List>
      <For each={props.paths}>
        {(path) => (
          <Tool.ListItem icon={<FileText class="size-4" />}>
            <span class="truncate font-mono text-xs">{path}</span>
          </Tool.ListItem>
        )}
      </For>
    </Tool.List>
  );
}
