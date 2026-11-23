import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PlusIcon from '@icon/system/regular/plus.svg';
import { DropdownSearchInput } from '@property/editors/selectors/PropertyOptionSelector';
import type { ToolPermissionCatalogGroup } from '@service-agent-harness/generated/schemas';
import { Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { groupIcon } from './group-icon';

/**
 * "+ Add exception": a searchable list of the entities that can take an
 * exception for this action (they have tools for it and none yet).
 */
export function EntityPicker(props: {
  /** "Add a Read exception", the trigger's accessible name. */
  label: string;
  entities: ToolPermissionCatalogGroup[];
  onPick: (group: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  let list: HTMLDivElement | undefined;

  const matches = () => {
    const needle = search().trim().toLocaleLowerCase();
    return props.entities.filter((group) =>
      group.name.toLocaleLowerCase().includes(needle)
    );
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch('');
  };

  return (
    <Dropdown open={open()} onOpenChange={changeOpen} placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        aria-label={props.label}
        disabled={props.entities.length === 0}
      >
        <PlusIcon aria-hidden="true" class="size-3.5 shrink-0" />
        {t('agentPermissions.addException')}
      </Dropdown.Trigger>
      <Dropdown.Content
        class="w-64 max-w-[calc(100vw-2rem)] p-0"
        aria-label={props.label}
        // The search field takes focus instead of the first entity.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownSearchInput
          value={search()}
          placeholder={t('agentPermissions.searchEntities')}
          onInput={setSearch}
          inputRef={(element) => {
            // On touch a focused field would raise the keyboard over the list.
            if (isTouchDevice()) return;
            queueMicrotask(() => element.isConnected && element.focus());
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') return;
            // Typing stays in the field rather than the menu's typeahead.
            event.stopPropagation();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              list?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
            }
          }}
        />
        <div ref={list} class="flex max-h-72 flex-col overflow-y-auto p-1.5">
          <Show
            when={matches().length > 0}
            fallback={
              <p class="px-2 py-3 text-sm text-ink-muted">
                {t('agentPermissions.noEntityMatch')}
              </p>
            }
          >
            <For each={matches()}>
              {(group) => {
                const Icon = groupIcon(group.id);
                return (
                  <Dropdown.Item
                    textValue={group.name}
                    onSelect={() => props.onPick(group.id)}
                  >
                    <Icon
                      aria-hidden="true"
                      class="size-4 shrink-0 text-ink-muted"
                    />
                    <span class="min-w-0 flex-1 truncate">{group.name}</span>
                  </Dropdown.Item>
                );
              }}
            </For>
          </Show>
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}
