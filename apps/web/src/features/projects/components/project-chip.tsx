import StackIcon from '@phosphor/stack.svg';
import { Show } from 'solid-js';
import type { TaskProjectReference } from '../core/project';

export function ProjectChip(props: {
  reference?: TaskProjectReference;
  onOpen(id: string, event: MouseEvent): void;
}) {
  const visible = () =>
    props.reference?.state === 'visible' ? props.reference : undefined;
  return (
    <Show
      when={visible()}
      fallback={
        <span class="text-ink-extra-muted">
          {props.reference?.state === 'unavailable'
            ? 'Unavailable project'
            : '—'}
        </span>
      }
    >
      {(project) => (
        <button
          type="button"
          data-blocks-navigation
          title={project().name}
          class="inline-flex max-w-full items-center gap-1 rounded-sm border border-edge-muted px-1.5 py-0.5 text-xs hover:bg-hover"
          onClick={(event) => {
            event.stopPropagation();
            props.onOpen(project().id, event);
          }}
        >
          <StackIcon class="size-3 shrink-0" />
          <span class="truncate">{project().name}</span>
        </button>
      )}
    </Show>
  );
}
