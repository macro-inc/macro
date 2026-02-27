import ChevronDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import { Select as KSelect } from '@kobalte/core/select';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, Show } from 'solid-js';

export const SoupFiltersBar = () => {
  const [active, setActive] = createSignal<Option[]>([]);
  return (
    <div>
      <FilterSelect
        options={[
          {
            value: 'one',
            label: 'One',
          },
          {
            value: 'two',
            label: 'Two',
          },
          {
            value: 'three',
            label: 'Three',
          },
        ]}
        onChange={setActive}
        active={active()}
        label="Test filter"
      />
    </div>
  );
};

type Option = { value: string; label: string };

interface FilterSelectProps {
  label: string;
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
}

const FilterSelect = (props: FilterSelectProps) => {
  const activeFilters = createMemo(() => {
    return props.active;
  });

  const activeCount = createMemo(() => activeFilters().length);
  const hasActiveFilters = createMemo(() => activeCount() > 0);

  return (
    <KSelect<Option, never>
      options={props.options}
      value={activeFilters()}
      onChange={props.onChange}
      optionTextValue="label"
      optionValue="value"
      gutter={4}
      multiple
      itemComponent={(itemProps) => (
        <KSelect.Item
          item={itemProps.item}
          class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-ink/5 data-[selected]:bg-accent/10 group"
        >
          <span
            class={
              'size-4 flex items-center justify-center shrink-0 rounded border border-edge-muted transition-colors group-data-[selected]:bg-accent group-data-[selected]:border-accent'
            }
          >
            <KSelect.ItemIndicator>
              <CheckIcon class="size-2.5 text-page" />
            </KSelect.ItemIndicator>
          </span>

          <KSelect.ItemLabel class="flex-1 truncate text-ink-muted group-data-[selected]:text-ink group-data-[selected]:font-medium">
            {itemProps.item.rawValue.label}
          </KSelect.ItemLabel>
        </KSelect.Item>
      )}
    >
      <KSelect.Trigger
        as="button"
        type="button"
        class={cn(
          'relative flex items-center gap-1 px-2 py-1.5 text-xs rounded-md bg-ink/8 text-ink-muted hover:bg-ink/12 hover:text-ink border border-transparent transition-all',
          hasActiveFilters() &&
            'bg-accent/15 text-accent border border-accent/30'
        )}
      >
        <span class="font-medium">{props.label}</span>
        <Show when={hasActiveFilters()}>
          <span class="absolute -top-2 -right-2 flex items-center justify-center size-4 rounded-full text-xs font-semibold bg-accent text-page">
            {activeCount()}
          </span>
        </Show>
        <ChevronDownIcon class="size-3" />
      </KSelect.Trigger>
      <KSelect.Portal>
        <KSelect.Content class="z-action-menu bg-panel border border-edge-muted rounded shadow-xl w-[var(--kb-popper-anchor-width)] max-w-sm">
          <KSelect.Listbox />
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
};
