import { t } from '@app/lib/i18n';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import LocationIcon from '@icon/system/regular/map-pin.svg';
import ShieldIcon from '@icon/system/regular/shield-check.svg';
import DescriptionIcon from '@icon/system/regular/text-align-left.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import VideoIcon from '@icon/system/regular/video-camera.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { CalendarSwatch } from '../../components/calendar-swatch/CalendarSwatch';
import { EventFormParts } from '../../components/composer/event-form-parts';
import { ComposerFieldRow } from '../../components/composer/field-row/ComposerFieldRow';
import { useEventForm } from '../../context/event-form-context';
import { DEFAULT_CALENDAR_SOURCE } from '../../types';
import { DesktopEventWhen } from './fields/DesktopEventWhen';

/** Desktop composition; fields keep the same controller and mutation ownership. */
export function DesktopEventForm() {
  const form = useEventForm();
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  const showDescription = () =>
    !form.isEdit() || Boolean(form.state().description) || optionsOpen();
  const showGuestPolicy = () => optionsOpen() && form.showsGuestPolicy();

  return (
    <>
      <div class="flex shrink-0 items-center gap-1.5 pt-2 pr-2.5 pl-4">
        <EventFormParts.KindPill />
        <div class="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('calendar.closeComposer')}
          disabled={form.formIsDisabled()}
          onClick={form.props.onCancel}
        >
          <CloseIcon class="size-4" />
        </Button>
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-1 pb-3">
        <ComposerFieldRow
          class="py-0"
          icon={
            <Show when={form.isEdit()}>
              <CalendarSwatch
                color={
                  form.controller.selectedCalendarOption()?.color ??
                  DEFAULT_CALENDAR_SOURCE.color
                }
              />
            </Show>
          }
        >
          <EventFormParts.Title />
        </ComposerFieldRow>
        <ComposerFieldRow icon={<ClockIcon class="size-4" />}>
          <DesktopEventWhen />
          <div class="mt-1 flex flex-wrap items-center gap-1">
            <EventFormParts.RecurrencePill />
          </div>
          <EventFormParts.RecurrenceScopeReason />
        </ComposerFieldRow>
        <Switch>
          <Match when={!form.isOutOfOffice()}>
            <Show when={showDescription()}>
              <ComposerFieldRow icon={<DescriptionIcon class="size-4" />}>
                <EventFormParts.Description />
              </ComposerFieldRow>
            </Show>
            <ComposerFieldRow icon={<UsersIcon class="size-4" />}>
              <EventFormParts.GuestsPill />
            </ComposerFieldRow>
            <ComposerFieldRow icon={<VideoIcon class="size-4" />}>
              <EventFormParts.ConferencePill />
            </ComposerFieldRow>
            <ComposerFieldRow icon={<LocationIcon class="size-4" />}>
              <EventFormParts.LocationInput />
            </ComposerFieldRow>
          </Match>
          <Match when={form.isOutOfOffice()}>
            <ComposerFieldRow icon={<CalendarIcon class="size-4" />}>
              <EventFormParts.DeclinePill />
            </ComposerFieldRow>
            <Show when={form.showsDeclineMessage()}>
              <ComposerFieldRow icon={<DescriptionIcon class="size-4" />}>
                <EventFormParts.DeclineMessagePill />
              </ComposerFieldRow>
            </Show>
          </Match>
        </Switch>
        <ComposerFieldRow icon={<CalendarIcon class="size-4" />}>
          <EventFormParts.CalendarPill />
        </ComposerFieldRow>
        <Show when={optionsOpen()}>
          <ComposerFieldRow icon={<BellIcon class="size-4" />}>
            <EventFormParts.RemindersPill />
          </ComposerFieldRow>
        </Show>
        <Show when={showGuestPolicy()}>
          <ComposerFieldRow icon={<ShieldIcon class="size-4" />}>
            <EventFormParts.GuestPolicy />
          </ComposerFieldRow>
        </Show>
        <EventFormParts.Notices />
        <EventFormParts.CustomRecurrence />
        <EventFormParts.SaveError />
      </div>
      <Show when={form.props.showRecurringEditNotice}>
        <div class="flex flex-wrap items-center gap-2 px-4 pb-2 text-xs text-ink-muted">
          <span>{t('calendar.applyChangesTo')}</span>
          <EventFormParts.EditScope />
        </div>
      </Show>
      <div class="flex shrink-0 items-center gap-2 border-t border-divider pt-2.5 pr-3 pb-3.5 pl-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={optionsOpen()}
          onClick={() => setOptionsOpen((open) => !open)}
        >
          {optionsOpen()
            ? t('calendar.fewerOptions')
            : t('calendar.moreOptions')}
          <CaretDownIcon
            class="size-3"
            classList={{ 'rotate-180': optionsOpen() }}
          />
        </Button>
        <div class="flex-1" />
        <EventFormParts.Status />
        <EventFormParts.Cancel />
        <EventFormParts.Submit />
      </div>
    </>
  );
}
