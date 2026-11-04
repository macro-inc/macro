import { Checkbox } from '@ui/components/Checkbox';
import { createSignal, For, Show } from 'solid-js';

/**
 * The Gmail labels or Outlook categories an email trigger requires, any one
 * of them. None chosen runs on every email.
 */
export function RoutineEmailLabels(props: {
  /** Label names across the owner's inboxes. */
  names: readonly string[];
  loading: boolean;
  selected: readonly string[];
  onChange: (labels: string[] | undefined) => void;
}) {
  const [search, setSearch] = createSignal('');
  const isSelected = (name: string) =>
    props.selected.some(
      (chosen) => chosen.toLowerCase() === name.toLowerCase()
    );
  const toggle = (name: string, on: boolean) => {
    const next = on
      ? [...props.selected, name]
      : props.selected.filter(
          (chosen) => chosen.toLowerCase() !== name.toLowerCase()
        );
    props.onChange(next.length ? next : undefined);
  };
  // Chosen labels stay listed after the provider renames or deletes them.
  const options = () =>
    [...new Set([...props.selected, ...props.names])]
      .filter((name) =>
        name.toLowerCase().includes(search().trim().toLowerCase())
      )
      .toSorted(
        (left, right) => Number(isSelected(right)) - Number(isSelected(left))
      );
  return (
    <div class="mb-3 grid gap-1">
      <span class="text-xs font-medium">Labels</span>
      <input
        aria-label="Search labels"
        placeholder={
          props.selected.length
            ? `${props.selected.length} selected · search…`
            : 'Any label · search to narrow…'
        }
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
        class="w-full rounded-md border border-edge-muted bg-input px-2 py-1.5 text-xs outline-none focus:border-accent"
      />
      <div
        role="group"
        aria-label="Labels"
        class="flex max-h-36 flex-col overflow-y-auto overscroll-contain"
      >
        <Show
          when={!props.loading}
          fallback={<p class="p-2 text-xs text-ink-muted">Loading…</p>}
        >
          <Show
            when={options().length}
            fallback={
              <p class="p-2 text-xs text-ink-muted">
                Your inboxes have no labels yet.
              </p>
            }
          >
            <For each={options()}>
              {(name) => (
                <Checkbox
                  class="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-hover touch:min-h-[44px]"
                  checked={isSelected(name)}
                  onChange={(on) => toggle(name, on)}
                >
                  <Checkbox.Control />
                  <Checkbox.Label class="truncate">{name}</Checkbox.Label>
                </Checkbox>
              )}
            </For>
          </Show>
        </Show>
      </div>
      <span class="text-xs text-ink-extra-muted">
        Gmail labels and Outlook categories. The email must carry one of them.
      </span>
    </div>
  );
}
