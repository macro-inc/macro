import type { DockPosition } from '@components/app/dock-prefs';
import { cn } from '@ui';
import { createUniqueId, For } from 'solid-js';

/** A miniature window with its dock against the chosen edge. */
function DockPreview(props: { position: DockPosition }) {
  const horizontal = () =>
    props.position === 'top' || props.position === 'bottom';
  return (
    <span
      class={cn(
        'absolute inset-0 flex gap-1 overflow-hidden rounded-lg bg-page p-1.5',
        props.position === 'left' && 'flex-row',
        props.position === 'right' && 'flex-row-reverse',
        props.position === 'top' && 'flex-col',
        props.position === 'bottom' && 'flex-col-reverse'
      )}
    >
      <span
        class={cn(
          'flex shrink-0 items-center justify-center gap-1 rounded-sm',
          horizontal() ? 'h-2.5 flex-row px-1' : 'w-2.5 flex-col py-1'
        )}
      >
        <For each={[0, 1, 2, 3]}>
          {() => <span class="size-1 rounded-full bg-ink/35" />}
        </For>
      </span>
      <span class="flex min-h-0 min-w-0 flex-1 flex-col gap-1 rounded-md border border-edge-muted bg-panel p-1.5">
        <span class="h-1 w-2/3 rounded-sm bg-ink/50" />
        <span class="h-1 w-full rounded-sm bg-ink/15" />
        <span class="h-1 w-4/5 rounded-sm bg-ink/15" />
      </span>
    </span>
  );
}

/** Pick the window edge the dock sits against, shown as small previews. */
export function DockPositionPicker(props: {
  value: DockPosition;
  onChange: (position: DockPosition) => void;
  label: string;
  options: readonly { value: DockPosition; label: string }[];
}) {
  const name = createUniqueId();
  return (
    <fieldset class="min-w-0" aria-label={props.label}>
      <div class="grid grid-cols-2 gap-3 @[460px]:grid-cols-4">
        <For each={props.options}>
          {(option) => (
            <label class="group flex min-w-0 flex-col items-center gap-2">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={props.value === option.value}
                onChange={() => props.onChange(option.value)}
                class="peer sr-only"
              />
              <span
                aria-hidden="true"
                class="relative block h-20 w-full rounded-xl border border-ink/10 p-1 transition-colors not-touch:group-hover:border-ink/25 peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent/30 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
              >
                <span class="absolute inset-1 overflow-hidden rounded-lg">
                  <DockPreview position={option.value} />
                </span>
              </span>
              <span class="text-sm text-ink-muted peer-checked:font-medium peer-checked:text-ink">
                {option.label}
              </span>
            </label>
          )}
        </For>
      </div>
    </fieldset>
  );
}
