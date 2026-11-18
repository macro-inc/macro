import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import { type JSX, type Ref, Show } from 'solid-js';
import { CalendarSwatch } from '../../../components/calendar-swatch/CalendarSwatch';
import { ComposerKind } from '../../../components/composer/kind/ComposerKind';
import { ComposerTitle } from '../../../components/composer/title/ComposerTitle';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { DEFAULT_CALENDAR_SOURCE } from '../../../types';

export function MobileComposerTitle(
  props: { icon?: JSX.Element; inputRef?: Ref<HTMLTextAreaElement> } = {}
) {
  const model = useCalendarComposer();
  return (
    <SheetGroup>
      <SheetRow
        icon={
          props.icon ?? (
            <CalendarSwatch
              color={
                model.controller.selectedCalendarOption()?.color ??
                DEFAULT_CALENDAR_SOURCE.color
              }
            />
          )
        }
      >
        <ComposerTitle
          autofocus={false}
          submitOnEnter={false}
          inputRef={props.inputRef}
        />
      </SheetRow>
      <Show when={!model.isEdit()}>
        <SheetRow>
          <ComposerKind />
        </SheetRow>
      </Show>
    </SheetGroup>
  );
}
