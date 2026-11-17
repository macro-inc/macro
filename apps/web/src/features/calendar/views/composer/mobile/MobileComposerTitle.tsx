import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import { CalendarSwatch } from '../../../components/calendar-swatch/CalendarSwatch';
import { ComposerTitle } from '../../../components/composer/title/ComposerTitle';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { DEFAULT_CALENDAR_SOURCE } from '../../../types';
import { MobileComposerKind } from './MobileComposerKind';

export function MobileComposerTitle() {
  const model = useCalendarComposer();
  return (
    <SheetGroup class="py-3">
      <SheetRow
        icon={
          <CalendarSwatch
            color={
              model.controller.selectedCalendarOption()?.color ??
              DEFAULT_CALENDAR_SOURCE.color
            }
          />
        }
      >
        <ComposerTitle autofocus={false} submitOnEnter={false} />
      </SheetRow>
      <SheetRow class="pt-2">
        <MobileComposerKind />
      </SheetRow>
    </SheetGroup>
  );
}
