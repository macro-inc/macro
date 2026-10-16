import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import PlusIcon from '@phosphor/plus.svg';
import TableIcon from '@phosphor/table.svg';
import { createSignal, For, Show } from 'solid-js';
import type { Pipeline } from '../core/pipeline';

export function PipelineSidebar(props: {
  pipelines: Pipeline[];
  activeId?: string;
  loading: boolean;
  error: boolean;
  canCreate: boolean;
  onCreate(): void;
  onSelect(id: string): void;
  onRetry(): void;
}) {
  const [open, setOpen] = createSignal(true);
  return (
    <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
      <CollapsibleSection.Trigger>
        <span>Pipelines</span>
        <CollapsibleSection.Indicator />
      </CollapsibleSection.Trigger>
      <CollapsibleSection.Content>
        <ViewSidebar.Nav aria-label="CRM pipelines">
          <For each={props.pipelines}>
            {(pipeline) => (
              <ViewSidebar.Item
                active={props.activeId === pipeline.id}
                title={pipeline.name}
                onClick={() => props.onSelect(pipeline.id)}
              >
                <ViewSidebar.Icon>
                  <TableIcon class="size-4" />
                </ViewSidebar.Icon>
                <span class="min-w-0 flex-1 truncate">{pipeline.name}</span>
                <span class="text-xs text-ink-extra-muted">
                  {pipeline.sharing === 'team' ? 'Team' : 'Private'}
                </span>
              </ViewSidebar.Item>
            )}
          </For>
          <Show when={props.loading}>
            <p class="px-3 py-2 text-xs text-ink-muted">Loading pipelines…</p>
          </Show>
          <Show when={props.error}>
            <ViewSidebar.Item onClick={props.onRetry}>
              Could not load pipelines. Retry
            </ViewSidebar.Item>
          </Show>
          <ViewSidebar.Item
            disabled={!props.canCreate}
            onClick={props.onCreate}
          >
            <ViewSidebar.Icon>
              <PlusIcon class="size-4" />
            </ViewSidebar.Icon>
            <span>New pipeline</span>
          </ViewSidebar.Item>
        </ViewSidebar.Nav>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}
