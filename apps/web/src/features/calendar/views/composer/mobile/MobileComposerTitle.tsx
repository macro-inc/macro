import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import { CalendarSwatch } from '../../../components/calendar-swatch/CalendarSwatch';
import { ComposerKind } from '../../../components/composer/kind/ComposerKind';
import { ComposerTitle } from '../../../components/composer/title/ComposerTitle';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { DEFAULT_CALENDAR_SOURCE } from '../../../types';

export function MobileComposerTitle(props: { agentDraft?: boolean } = {}) {
  const model = useCalendarComposer();
  return (
    <SheetGroup>
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
      <SheetRow>
        <ComposerKind agentDraft={props.agentDraft} />
      </SheetRow>
    </SheetGroup>
  );
}
