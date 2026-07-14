import CaretRight from '@phosphor/caret-right.svg?component-solid';
import { Layer } from '@ui';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, Show } from 'solid-js';

export function AssistantActivityGroup(props: {
  children: JSX.Element;
  itemCount: number;
  preview?: string;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const isGrouped = createMemo(() => props.itemCount > 1);
  const stepLabel = () =>
    `${props.itemCount} ${props.itemCount === 1 ? 'step' : 'steps'}`;

  return (
    <Layer depth={0}>
      <div
        class="text-xs leading-5 text-ink-extra-muted"
        classList={{
          'overflow-hidden rounded-lg border border-edge-muted bg-surface':
            isGrouped(),
        }}
      >
        <Show when={isGrouped()}>
          <button
            type="button"
            data-testid="activity-toggle"
            class="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left hover:text-ink-muted"
            aria-expanded={expanded()}
            onClick={() => setExpanded((previous) => !previous)}
          >
            <CaretRight
              class="size-4 shrink-0 transition-transform"
              classList={{ 'rotate-90': expanded() }}
            />
            <span class="shrink-0">{stepLabel()}</span>
            <Show when={!expanded() && props.preview}>
              {(preview) => (
                <span
                  data-testid="activity-preview"
                  class="min-w-0 flex-1 truncate text-right text-ink-extra-muted transition-opacity"
                  style={{
                    '-webkit-mask-image':
                      'linear-gradient(to right, transparent, black 25%)',
                    'mask-image':
                      'linear-gradient(to right, transparent, black 25%)',
                  }}
                >
                  {preview()}
                </span>
              )}
            </Show>
          </button>
        </Show>
        <div
          data-testid="activity-content"
          classList={{
            'border-t border-edge-muted divide-y divide-edge-muted':
              isGrouped(),
            hidden: isGrouped() && !expanded(),
          }}
        >
          {props.children}
        </div>
      </div>
    </Layer>
  );
}
