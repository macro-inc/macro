import { t } from '@app/lib/i18n';
import { keepSearchFocused } from '@core/component/AI/component/input/model-catalog-search';
import type { CatalogModelOption } from '@core/component/AI/component/input/modelCatalog';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import Check from '@icon/system/regular/check.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import { Key } from '@solid-primitives/keyed';
import { Dropdown } from '@ui';
import { createMemo, createSignal, onMount, Show } from 'solid-js';
import { modelSelection } from '../../core/model-selection';

/** The remaining catalog shares the parent menu, never duplicating Suggested. */
export function AllModelsMenu(props: {
  options: CatalogModelOption[];
  model?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = createSignal('');
  const catalog = createMemo(() => props.options);
  const providers = createMemo(
    () => modelSelection(catalog(), [], query()).allProviders
  );
  let search: HTMLInputElement | undefined;
  onMount(() => keepSearchFocused(() => search));

  return (
    <div>
      <div class="flex h-10 shrink-0 items-center gap-2 px-3.5">
        <Search class="size-4 shrink-0 text-ink-extra-muted" />
        <input
          ref={search}
          aria-label={t('agentControls.searchModels')}
          placeholder={t('agentControls.searchModels')}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              const menu = event.currentTarget.closest('[role="menu"]');
              const rows = menu?.querySelectorAll<HTMLElement>(
                '[role="menuitemradio"]:not([data-disabled]):not([aria-disabled="true"])'
              );
              const row =
                event.key === 'ArrowDown' ? rows?.[0] : rows?.[rows.length - 1];
              row?.focus();
              return;
            }
            if (event.key !== 'Escape' && event.key !== 'ArrowLeft') {
              event.stopPropagation();
            }
          }}
          class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-extra-muted"
        />
      </div>
      <Key each={providers()} by="label">
        {(provider) => (
          <Dropdown.Group>
            <Dropdown.GroupLabel>{provider().label}</Dropdown.GroupLabel>
            <Dropdown.RadioGroup value={props.model}>
              <Key each={provider().options} by="id">
                {(option) => (
                  <Dropdown.RadioItem
                    value={option().id}
                    disabled={props.disabled}
                    closeOnSelect
                    onSelect={() => props.onSelect(option().id)}
                  >
                    <ModelIcon model={option().id} />
                    <Dropdown.ItemLabel class="min-w-0 flex-1 truncate">
                      {option().label}
                    </Dropdown.ItemLabel>
                    <Dropdown.ItemIndicator>
                      <Check class="size-3.5 text-accent" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                )}
              </Key>
            </Dropdown.RadioGroup>
          </Dropdown.Group>
        )}
      </Key>
      <Show when={providers().length === 0}>
        <p role="status" class="p-1.5 px-2 text-sm text-ink-extra-muted">
          {t('agentControls.noMatches')}
        </p>
      </Show>
    </div>
  );
}
