import { t } from '@app/lib/i18n';
import XIcon from '@icon/system/regular/x.svg';
import { ButtonGroup, Dropdown, Layer, SingleSelectCheck } from '@ui';
import { For, Show } from 'solid-js';
import {
  type EmailSearchScopeId,
  emailSearchScopeLabel,
} from '../search/email-search-scope';

// Presses keep the keyboard in the search field.
const keepFocus = (event: Event) => event.preventDefault();

/**
 * The view a search is narrowed to, inside the search field, read as global
 * Search's filter chips are: `In | Sent | ✕`. The ✕ returns to all mail.
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
    <Layer depth={2}>
      <ButtonGroup
        aria-label={t('emailViews.searchIn')}
        size="xs"
        class="shrink-0"
      >
        <span class="inline-flex items-center px-2 text-xs text-ink-muted">
          {t('emailViews.searchIn')}
        </span>
        <ButtonGroup.Divider />
        <Show
          when={props.menu}
          fallback={
            <span class="inline-flex items-center px-2 text-xs text-ink">
              {label()}
            </span>
          }
        >
          {(menu) => (
            <Dropdown>
              <Dropdown.Trigger
                as={ButtonGroup.Button}
                variant="ghost"
                size="xs"
                aria-label={t('emailViews.changeSearchView')}
              >
                {label()}
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
        <ButtonGroup.Divider />
        <ButtonGroup.Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('emailViews.removeSearchView', { view: label() })}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemove();
          }}
        >
          <XIcon class="size-3.5" />
        </ButtonGroup.Button>
      </ButtonGroup>
    </Layer>
  );
}
