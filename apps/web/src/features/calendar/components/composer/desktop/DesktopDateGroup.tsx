import { t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { parseLocalDate } from '@core/util/local-date';
import ArrowIcon from '@icon/system/regular/arrow-right.svg';
import { Popover } from '@kobalte/core/popover';
import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { useComposerWhen } from '../../../context/composer-when-context';
import { ComposerRecurrence } from '../recurrence/ComposerRecurrence';
import { ComposerTimeZone } from '../time-zone/ComposerTimeZone';
import { ComposerRangeFeedback } from '../when/ComposerRangeFeedback';
import { WhenDate } from '../when/WhenDate';
import { WhenMonth } from '../when/WhenMonth';
import { WhenTime } from '../when/WhenTime';

function DatePicker(props: { endpoint: 'start' | 'end' }) {
  const model = useCalendarComposer();
  const when = useComposerWhen();
  let anchor: HTMLDivElement | undefined;
  const key = () => (props.endpoint === 'start' ? 'start-date' : 'end-date');
  return (
    <Popover
      open={when.state.active === key()}
      onOpenChange={(value) => {
        if (!value) when.close(key());
      }}
      anchorRef={() => anchor}
      placement="bottom-start"
      gutter={4}
    >
      <div ref={anchor}>
        <WhenDate endpoint={props.endpoint} desktop />
      </div>
      <Show when={when.state.active === key()}>
        <ScopedPortal scope="local">
          <Popover.Content
            class="menu-surface z-action-menu rounded-xl p-2 outline-none"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <Popover.Title class="sr-only">
              {t('common.chooseDateRange')}
            </Popover.Title>
            <WhenMonth
              size="desktop"
              value={
                parseLocalDate(model.state()[props.endpoint].slice(0, 10)) ??
                new Date()
              }
              onChange={(date) => {
                when.chooseDate(props.endpoint, date);
                when.close(key());
              }}
            />
          </Popover.Content>
        </ScopedPortal>
      </Show>
    </Popover>
  );
}

export function DesktopDateGroup(props: { pinned?: boolean }) {
  const model = useCalendarComposer();
  const when = useComposerWhen();
  const differentDay = () =>
    model.state().start.slice(0, 10) !== model.state().end.slice(0, 10);
  return (
    <div class="flex flex-col gap-2">
      <div
        class="flex min-h-8 items-center gap-2"
        classList={{ 'flex-wrap': props.pinned, 'flex-nowrap': !props.pinned }}
      >
        <DatePicker endpoint="start" />
        <Show when={!model.state().allDay}>
          <WhenTime endpoint="start" compact />
        </Show>
        <ArrowIcon class="size-4 shrink-0 text-ink-muted" />
        <Show when={model.state().allDay || differentDay()}>
          <DatePicker endpoint="end" />
        </Show>
        <Show when={!model.state().allDay}>
          <WhenTime endpoint="end" compact />
        </Show>
      </div>
      <div class="flex min-h-8 items-center gap-2">
        <ToggleSwitch
          size="compact"
          label={t('calendar.allDay')}
          labelClass="text-sm text-ink-muted"
          checked={model.state().allDay}
          disabled={model.fieldIsDisabled('allDay')}
          onChange={when.allDay}
        />
        <Show when={!model.state().allDay}>
          <ComposerTimeZone size="md" />
        </Show>
      </div>
      <div>
        <ComposerRecurrence size="md" />
      </div>
      <ComposerRangeFeedback />
    </div>
  );
}
