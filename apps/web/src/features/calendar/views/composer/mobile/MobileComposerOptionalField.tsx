import { t } from '@app/lib/i18n';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';
import type { ComposerOptionalField } from '../../../primitives/create-composer-optional-fields';
import { MobileComposerAddRow } from './MobileComposerAddRow';

export function MobileComposerOptionalField(
  props: ParentProps<{
    field: ComposerOptionalField;
    label: string;
    icon: JSX.Element;
    visible: boolean;
    empty: boolean;
    disabled: boolean;
    onReveal: (button: HTMLButtonElement) => void;
    onRemove: () => boolean;
    onFocus: () => void;
  }>
) {
  let row: HTMLDivElement | undefined;
  return (
    <div ref={row} data-optional-field={props.field}>
      <Show
        when={props.visible}
        fallback={
          <MobileComposerAddRow
            label={props.label}
            icon={props.icon}
            disabled={props.disabled}
            onClick={props.onReveal}
          />
        }
      >
        <SheetRow
          class="items-start py-1"
          icon={<span class="pt-[13px]">{props.icon}</span>}
        >
          <div class="relative w-full" onFocusIn={props.onFocus}>
            {props.children}
            <Show when={props.empty && !props.disabled}>
              <Button
                variant="ghost"
                size="sheet"
                class="absolute right-0 top-0 w-11 px-0"
                aria-label={t(
                  props.field === 'description'
                    ? 'calendar.removeDescription'
                    : 'calendar.removeLocation'
                )}
                onClick={() => {
                  if (!props.onRemove()) return;
                  queueMicrotask(() =>
                    row
                      ?.querySelector<HTMLButtonElement>('button')
                      ?.focus({ preventScroll: true })
                  );
                }}
              >
                <CloseIcon class="size-4" />
              </Button>
            </Show>
          </div>
        </SheetRow>
      </Show>
    </div>
  );
}
