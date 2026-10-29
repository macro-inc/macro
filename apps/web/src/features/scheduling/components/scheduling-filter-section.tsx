import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';

type Option = { value: string; label: string; email?: string };

export function SchedulingFilterSection(props: {
  value: string;
  label: string;
  selected: string;
  options: Option[];
  onChange: (value: string) => void;
  activeCount?: number;
  renderIcon?: (option: Option) => JSX.Element;
}) {
  const [search, setSearch] = createSignal('');
  const visible = () => {
    const query = search().trim().toLowerCase();
    return query
      ? props.options.filter((option) =>
          `${option.label} ${option.email ?? ''}`.toLowerCase().includes(query)
        )
      : props.options;
  };

  return (
    <MobileFilterDrawer.Section
      value={props.value}
      label={props.label}
      activeCount={props.activeCount ?? Number(props.selected !== 'all')}
    >
      <Show when={props.options.length > 8}>
        <div class="mx-3 my-2 flex items-center gap-2 rounded-xl bg-input px-3 py-2">
          <SearchIcon
            aria-hidden="true"
            class="size-4 shrink-0 text-ink-muted"
          />
          <input
            type="search"
            aria-label={`Search ${props.label.toLowerCase()}`}
            placeholder={`Search ${props.label.toLowerCase()}…`}
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
          />
        </div>
      </Show>
      <div role="radiogroup" aria-label={props.label}>
        <For each={visible()}>
          {(option) => (
            <MobileFilterDrawer.Option
              selectionMode="single"
              checked={props.selected === option.value}
              onChange={() => props.onChange(option.value)}
              icon={props.renderIcon?.(option)}
            >
              {option.label}
            </MobileFilterDrawer.Option>
          )}
        </For>
        <Show when={!visible().length}>
          <p class="px-3 py-3 text-sm text-ink-muted">No matches found</p>
        </Show>
      </div>
    </MobileFilterDrawer.Section>
  );
}
