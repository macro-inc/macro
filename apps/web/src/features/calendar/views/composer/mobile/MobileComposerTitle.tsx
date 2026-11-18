import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import AgentMark from '@icon/system/regular/sparkle.svg';
import { type Ref, Show } from 'solid-js';
import { CalendarSwatch } from '../../../components/calendar-swatch/CalendarSwatch';
import { ComposerKind } from '../../../components/composer/kind/ComposerKind';
import { ComposerTitle } from '../../../components/composer/title/ComposerTitle';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { DEFAULT_CALENDAR_SOURCE } from '../../../types';

export function MobileComposerTitle(
  props: { agentDraft?: boolean; inputRef?: Ref<HTMLTextAreaElement> } = {}
) {
  const model = useCalendarComposer();
  return (
    <SheetGroup>
      <SheetRow
        icon={
          <Show
            when={props.agentDraft}
            fallback={
              <CalendarSwatch
                color={
                  model.controller.selectedCalendarOption()?.color ??
                  DEFAULT_CALENDAR_SOURCE.color
                }
              />
            }
          >
            <AgentMark class="size-4 text-ink-muted" />
          </Show>
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
