import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Dropdown, SingleSelectCheck } from '@ui';
import { For, Show } from 'solid-js';
import {
  type EmailSearchScopeId,
  emailSearchScopeLabel,
} from '../search/email-search-scope';

// Presses keep the keyboard in the search field.
const keepFocus = (event: Event) => event.preventDefault();

/**
 * The view a search is narrowed to, as a filled token inside the search
 * field, drawn like ChipCombobox's chips: `In Sent ×`. The × returns to all
 * mail.
 */
export function EmailSearchScopeChip(props: {
  scope: EmailSearchScopeId;
  /** The views its name switches to; without it, the name opens no menu. */
  menu?: {
    options: readonly EmailSearchScopeId[];
    onChange: (scope: EmailSearchScopeId) => void;
  };
  onRemove: () => void;
}) {
  const label = () => emailSearchScopeLabel(props.scope);

  return (
    <span
      role="group"
      aria-label={t('emailViews.searchIn')}
      class="flex h-6 max-w-full shrink-0 items-center gap-0.5 overflow-hidden rounded-full bg-active pr-0.5 pl-2.5 text-xs leading-none touch:h-7 touch:text-sm"
    >
      <span class="shrink-0 text-ink-muted">{t('emailViews.searchIn')}</span>
      <Show
        when={props.menu}
        fallback={
          <span class="min-w-0 truncate px-1 font-medium text-ink">
            {label()}
          </span>
        }
      >
        {(menu) => (
          <Dropdown>
            <Dropdown.Trigger
              variant="ghost"
              size="xs"
              aria-label={t('emailViews.changeSearchView')}
              class="min-w-0 gap-0.5 px-1 text-ink"
            >
              <span class="truncate">{label()}</span>
              <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
            </Dropdown.Trigger>
            <Dropdown.Content portalScope="local" class="min-w-40">
              <Dropdown.Group>
                <For each={menu().options}>
                  {(scope) => (
                    <Dropdown.Item
                      onSelect={() => menu().onChange(scope)}
                      closeOnSelect
                    >
                      <span class="flex-1 truncate">
                        {emailSearchScopeLabel(scope)}
                      </span>
                      <SingleSelectCheck active={props.scope === scope} />
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        )}
      </Show>
      <button
        type="button"
        aria-label={t('emailViews.removeSearchView', { view: label() })}
        class="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-muted not-touch:hover:bg-hover not-touch:hover:text-ink touch:size-6"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={(event) => {
          event.stopPropagation();
          props.onRemove();
        }}
      >
        <XIcon class="size-3" />
      </button>
    </span>
  );
}
