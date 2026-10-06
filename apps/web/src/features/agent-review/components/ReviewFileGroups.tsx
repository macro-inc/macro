import EyeIcon from '@phosphor/eye.svg';
import EyeSlashIcon from '@phosphor/eye-slash.svg';
import { Button, cn } from '@ui';
import { For, Show } from 'solid-js';
import type { FileGroup } from '../core/model';

export function ReviewFileGroups(props: {
  groups: FileGroup[];
  onToggle: (key: string) => void;
}) {
  return (
    <Show when={props.groups.length}>
      <div
        class="flex flex-wrap gap-1 border-b border-edge-muted px-3 py-2"
        aria-label="File visibility"
      >
        <For each={props.groups}>
          {(group) => (
            <Button
              size="xs"
              variant="ghost"
              class={cn('gap-1 text-[11px]', group.hidden && 'text-ink-subtle')}
              aria-pressed={!group.hidden}
              label={`${group.hidden ? 'Show' : 'Hide'} ${group.title} (${group.files.length} files)`}
              onClick={() => props.onToggle(group.key)}
            >
              <Show when={group.hidden} fallback={<EyeIcon />}>
                <EyeSlashIcon />
              </Show>
              {group.title}
              <span class="text-[10px] tabular-nums text-ink-subtle">
                {group.files.length}
              </span>
            </Button>
          )}
        </For>
      </div>
    </Show>
  );
}
