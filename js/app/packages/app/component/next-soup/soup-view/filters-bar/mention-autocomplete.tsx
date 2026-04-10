import { cn } from '@ui/utils/classname';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { createMemo, For, Show } from 'solid-js';
import type { AutocompleteOption } from './search-operator-autocomplete';

interface MentionAutocompleteProps {
  partial: string;
  onSelect: (option: AutocompleteOption) => void;
  highlightedIndex: () => number;
  setHighlightedIndex: (index: number) => void;
}

export const MentionAutocomplete = (props: MentionAutocompleteProps) => {
  const { useList } = useQuickAccess();
  const contacts = useList('person');
  const userId = useUserId();

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

  const filteredOptions = createMemo((): AutocompleteOption[] => {
    const partial = props.partial.toLowerCase();
    if (!partial) return contactOptions();
    return contactOptions().filter((opt) =>
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
          Mention
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
                onClick={() => props.onSelect(option)}
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
