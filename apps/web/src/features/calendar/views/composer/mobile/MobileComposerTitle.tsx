import { SheetGroup } from '@components/app/mobile/SheetGroup';
import { SheetRow } from '@components/app/mobile/SheetRow';
import { type JSX, type Ref, Show } from 'solid-js';
import { CalendarSwatch } from '../../../components/CalendarSwatch';
import { ComposerKind } from '../../../components/composer/parts/ComposerKind';
import { ComposerTitle } from '../../../components/composer/parts/ComposerTitle';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function MobileComposerTitle(
  props: { icon?: JSX.Element; inputRef?: Ref<HTMLTextAreaElement> } = {}
) {
  const model = useCalendarComposer();
  return (
    <SheetGroup>
      <SheetRow
        icon={props.icon ?? <CalendarSwatch color={model.calendarColor()} />}
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
