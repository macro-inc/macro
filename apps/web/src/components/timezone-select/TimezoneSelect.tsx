import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { Combobox } from '@kobalte/core/combobox';
import { buttonClasses, Dropdown, Layer, selectTriggerClasses } from '@ui';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import { TimezoneListbox } from './TimezoneListbox';
import type { TimezoneOption } from './types';

/**
 * A single-select timezone dropdown built on the same portalled, searchable
 * Combobox the rest of the app uses, so a 400-zone list stays a normal-sized
 * scrollable menu rather than the browser's full-height native picker.
 */
export function TimezoneSelect(props: {
  value: string;
  onChange: (zone: string) => void;
  options: TimezoneOption[];
  class?: string;
  portalScope?: 'local';
  disabled?: boolean;
  label?: string;
  selectionLabel?: string;
  appearance?: 'default' | 'value' | 'ghost';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
}) {
  let triggerRef: HTMLButtonElement | undefined;
  let searchRef: HTMLInputElement | undefined;
  let restoreTriggerFocus = true;
  const [localOpen, setLocalOpen] = createSignal(false);
  const open = () => props.open ?? localOpen();
  const setOpen = (value: boolean) => {
    setLocalOpen(value);
    props.onOpenChange?.(value);
  };
  const [search, setSearch] = createSignal('');
  // Losing edit permission closes the popup; enabling the field must not reopen it.
  createEffect(
    on(
      () => props.disabled,
      (disabled) => {
        if (!disabled) return;
        setOpen(false);
        setSearch('');
      }
    )
  );
  // Keep the current zone in the collection even when the runtime no longer
  // lists it (a zone dropped between releases), so it resolves as the selection
  // and a stray pick cannot silently replace a still-valid stored zone.
  const optionsWithCurrent = createMemo(() =>
    props.options.some((option) => option.value === props.value)
      ? props.options
      : [
          { value: props.value, label: props.value.replace(/_/g, ' ') },
          ...props.options,
        ]
  );
  const selected = () =>
    optionsWithCurrent().find((option) => option.value === props.value) ?? null;
  const triggerLabel = () =>
    props.selectionLabel ?? selected()?.label ?? props.value.replace(/_/g, ' ');
  const hasMatches = () => {
    const query = search().trim().toLowerCase();
    if (!query) return optionsWithCurrent().length > 0;
    return optionsWithCurrent().some((option) =>
      option.label.toLowerCase().includes(query)
    );
  };

  return (
    <Combobox<TimezoneOption>
      open={open() && !props.disabled}
      disabled={props.disabled}
      multiple={false}
      options={optionsWithCurrent()}
      value={selected()}
      onChange={(option) => {
        if (option && !props.disabled) props.onChange(option.value);
      }}
      onInputChange={setSearch}
      onOpenChange={(open) => {
        const nextOpen = open && !props.disabled;
        if (nextOpen) restoreTriggerFocus = true;
        setOpen(nextOpen);
        if (!nextOpen) setSearch('');
      }}
      optionValue="value"
      optionTextValue="label"
      // Empty so Kobalte does not seed the search box with the selected zone's
      // text on open — our own trigger shows the selection; the box is for
      // filtering, which still runs on `optionTextValue`.
      optionLabel={() => ''}
      virtualized
      allowsEmptyCollection
      placement="bottom-start"
      gutter={4}
    >
      <Combobox.Control class="min-w-0 flex-1">
        <Combobox.Trigger
          ref={triggerRef}
          type="button"
          aria-label={props.label ?? t('common.timezone')}
          tabIndex={0}
          onKeyDown={(event: KeyboardEvent) => {
            if (props.disabled) return;
            if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key))
              return;
            event.preventDefault();
            restoreTriggerFocus = true;
            setOpen(true);
            queueMicrotask(() => searchRef?.focus());
          }}
          class={
            props.appearance === 'value' || props.appearance === 'ghost'
              ? buttonClasses({
                  variant:
                    props.appearance === 'ghost'
                      ? 'ghost'
                      : props.fullWidth
                        ? 'row'
                        : 'value',
                  size: props.fullWidth ? 'sheet-row' : (props.size ?? 'sm'),
                  fullWidth: props.fullWidth,
                  class: `min-w-0 ${props.fullWidth ? 'justify-between' : ''} ${props.class ?? ''}`,
                })
              : selectTriggerClasses(
                  `min-w-0 text-sm touch:h-9 ${props.class ?? ''}`
                )
          }
        >
          <span class="truncate">{triggerLabel()}</span>
          <Show when={props.appearance !== 'ghost'}>
            <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
          </Show>
        </Combobox.Trigger>
      </Combobox.Control>

      <Show when={open() && !props.disabled}>
        <Combobox.Portal
          mount={
            props.portalScope === 'local'
              ? (triggerRef?.closest<HTMLElement>('.portal-scope') ?? undefined)
              : undefined
          }
        >
          <Layer depth={2}>
            <Combobox.Content
              as={Dropdown.ContentFrame}
              onInteractOutside={() => {
                restoreTriggerFocus = false;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (restoreTriggerFocus && triggerRef?.isConnected) {
                  triggerRef.focus({ preventScroll: true });
                }
              }}
              class="w-[24rem] max-w-[90vw] overflow-hidden"
            >
              <div class="flex items-center gap-2 border-b border-edge-muted px-3 py-2">
                <SearchIcon class="size-3.5 shrink-0 text-ink-muted" />
                <Combobox.Input
                  ref={searchRef}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key !== 'Escape' || !open()) return;
                    // Kobalte closes on the input before the parent's document listener.
                    // Consume this press so it cannot also discard the composer.
                    event.preventDefault();
                    event.stopImmediatePropagation();
                  }}
                  class="min-w-0 flex-1 bg-transparent text-sm caret-accent outline-none placeholder:text-ink-placeholder"
                  placeholder={t('common.searchTimezones')}
                  aria-label={t('common.searchTimezones')}
                />
              </div>
              <Dropdown.GroupFrame>
                <Show
                  when={hasMatches()}
                  fallback={
                    <div class="px-2 py-3 text-center text-xs text-ink-muted">
                      {t('common.noMatchingTimezones', { query: search() })}
                    </div>
                  }
                >
                  <TimezoneListbox />
                </Show>
              </Dropdown.GroupFrame>
            </Combobox.Content>
          </Layer>
        </Combobox.Portal>
      </Show>
    </Combobox>
  );
}
