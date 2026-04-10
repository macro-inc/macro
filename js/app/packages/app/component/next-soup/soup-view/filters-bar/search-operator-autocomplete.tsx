import { cn } from '@ui/utils/classname';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { createMemo, For, type JSX, Show } from 'solid-js';
import type { ActiveOperator, OperatorType } from './parse-search-operators';
import { INDEX_OPTIONS as INDEX_OPTIONS_SOURCE } from './search-filter-controls';

export type AutocompleteOption = {
  id: string;
  label: string;
  icon?: () => JSX.Element;
};

export const INDEX_OPTIONS: AutocompleteOption[] = INDEX_OPTIONS_SOURCE.map(
  (o) => ({ id: o.value, label: o.label, icon: o.icon })
);

interface SearchOperatorAutocompleteProps {
  activeOperator: ActiveOperator;
  onSelect: (type: OperatorType, option: AutocompleteOption) => void;
  onDismiss: () => void;
  highlightedIndex: () => number;
  setHighlightedIndex: (index: number) => void;
}

export const SearchOperatorAutocomplete = (
  props: SearchOperatorAutocompleteProps
) => {
  const { useList } = useQuickAccess();
  const channels = useList('channel', 'dm');
  const contacts = useList('person');
  const userId = useUserId();

  const channelOptions = createMemo((): AutocompleteOption[] =>
    channels()
      .filter((ch) => ch.data.name)
      .map((ch) => ({
        id: ch.id,
        label: ch.data.name,
        icon: () => (
          <EntityIcon targetType={ch.data.channelType || 'channel'} size="xs" />
        ),
      }))
  );

  const contactOptions = createMemo((): AutocompleteOption[] => {
    const currentUserId = userId();
    let me: AutocompleteOption | undefined;
    const others: AutocompleteOption[] = [];
    for (const c of contacts()) {
      const opt: AutocompleteOption = {
        id: c.id,
        label:
          c.id === currentUserId
            ? `${c.data.name || 'Me'} (me)`
            : c.data.name || c.id,
        icon: () => (
          <UserIcon id={c.id} size="xs" suppressClick showTooltip={false} />
        ),
      };
      if (c.id === currentUserId) {
        me = opt;
      } else {
        others.push(opt);
      }
    }
    return [...(me ? [me] : []), ...others];
  });

  const baseOptions = createMemo((): AutocompleteOption[] => {
    switch (props.activeOperator.type) {
      case 'index':
        return INDEX_OPTIONS;
      case 'in':
        return channelOptions();
      case 'from':
        return contactOptions();
    }
  });

  const filteredOptions = createMemo((): AutocompleteOption[] => {
    const partial = props.activeOperator.partial.toLowerCase();
    if (!partial) return baseOptions();
    return baseOptions().filter((opt) =>
      opt.label.toLowerCase().includes(partial)
    );
  });

  return (
    <Show when={filteredOptions().length > 0}>
      <div
        data-operator-dropdown
        class="absolute left-0 top-full mt-1 z-action-menu bg-surface-0 border border-edge-muted rounded-sm shadow-md min-w-[200px] max-w-[320px] max-h-[240px] overflow-y-auto p-1"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div class="px-2 py-1 text-[10px] text-ink-faint uppercase tracking-wider">
          {props.activeOperator.type === 'index' && 'Filter by type'}
          {props.activeOperator.type === 'in' && 'Filter by channel'}
          {props.activeOperator.type === 'from' && 'Filter by sender'}
        </div>
        <For each={filteredOptions()}>
          {(option, index) => {
            const highlighted = () => props.highlightedIndex() === index();
            return (
              <button
                type="button"
                class={cn(
                  'w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xs text-left text-xs transition-colors',
                  highlighted() ? 'bg-hover' : 'hover:bg-hover'
                )}
                onClick={() =>
                  props.onSelect(props.activeOperator.type, option)
                }
                onMouseEnter={() => props.setHighlightedIndex(index())}
              >
                <Show when={option.icon}>
                  {(icon) => (
                    <span class="size-4 flex items-center justify-center shrink-0">
                      {icon()()}
                    </span>
                  )}
                </Show>
                <span class="flex-1 truncate text-ink-muted">
                  {option.label}
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
};
