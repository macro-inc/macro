import { t } from '@app/lib/i18n';
import { triggerFocusInput } from '@core/directive/focusInput';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { type ComponentProps, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import {
  type ComposerOptionalField,
  createComposerOptionalFields,
} from '../../../primitives/create-composer-optional-fields';
import { ComposerDescription } from './ComposerDescription';
import { ComposerLocation } from './ComposerLocation';

export function DesktopOptionalField(props: {
  field: ComposerOptionalField;
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
}) {
  const model = useCalendarComposer();
  const fields = createComposerOptionalFields({
    value: (field) => model.state()[field],
    disabled: model.fieldIsDisabled,
  });
  let root: HTMLDivElement | undefined, input: HTMLElement | undefined;
  const label = () =>
    t(
      props.field === 'description'
        ? 'calendar.addDescription'
        : 'calendar.addLocation'
    );
  return (
    <div ref={root} data-optional-field={props.field} class="relative w-full">
      <Show
        when={fields.visible(props.field)}
        fallback={
          <Button
            variant="value"
            size="sm"
            disabled={model.fieldIsDisabled(props.field)}
            onClick={(event) => {
              if (fields.reveal(props.field))
                triggerFocusInput(() => input, event.currentTarget);
            }}
          >
            {label()}
          </Button>
        }
      >
        <div onFocusIn={() => fields.reveal(props.field)}>
          <Show
            when={props.field === 'description'}
            fallback={
              <ComposerLocation inputRef={(element) => (input = element)} />
            }
          >
            <ComposerDescription
              inputRef={(element) => (input = element)}
              resolveAppLink={props.resolveAppLink}
            />
          </Show>
        </div>
        <Show
          when={
            fields.empty(props.field) && !model.fieldIsDisabled(props.field)
          }
        >
          <Button
            variant="ghost"
            size="icon-sm"
            class="absolute right-1 top-1"
            aria-label={t(
              props.field === 'description'
                ? 'calendar.removeDescription'
                : 'calendar.removeLocation'
            )}
            onClick={() => {
              if (fields.remove(props.field))
                queueMicrotask(() =>
                  root
                    ?.querySelector<HTMLButtonElement>('button')
                    ?.focus({ preventScroll: true })
                );
            }}
          >
            <CloseIcon class="size-4" />
          </Button>
        </Show>
      </Show>
    </div>
  );
}
