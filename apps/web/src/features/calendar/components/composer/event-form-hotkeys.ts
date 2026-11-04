import { t } from '@app/lib/i18n';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import type { EventFormState } from './event-form-state';

/**
 * Controls the shortcuts move to, by accessible name, in the order tried: an
 * all-day range has no time field, so its date takes the time's shortcut.
 */
const FIELD_SHORTCUTS: {
  hotkey: ValidHotkey;
  token: HotkeyToken;
  description: () => string;
  labels: string[];
  /** Open the control's picker as well, as a click would. */
  open?: boolean;
}[] = [
  {
    hotkey: 'shift+cmd+s',
    token: TOKENS.calendar.composer.editStart,
    description: () => t('commands.editEventStart'),
    labels: ['event start time', 'Edit event start date'],
  },
  {
    hotkey: 'shift+cmd+e',
    token: TOKENS.calendar.composer.editEnd,
    description: () => t('commands.editEventEnd'),
    labels: ['event end time', 'Edit event end date'],
  },
  {
    hotkey: 'shift+cmd+g',
    token: TOKENS.calendar.composer.editGuests,
    description: () => t('commands.editEventGuests'),
    labels: ['Guests'],
    open: true,
  },
  {
    hotkey: 'shift+cmd+l',
    token: TOKENS.calendar.composer.editLocation,
    description: () => t('commands.editEventLocation'),
    labels: ['Location'],
    open: true,
  },
  {
    hotkey: 'shift+cmd+m',
    token: TOKENS.calendar.composer.editConference,
    description: () => t('commands.editEventConference'),
    labels: ['Video conferencing'],
  },
];

/** Keyboard shortcuts that fill in and save an event form from any of its fields. */
export function registerEventFormHotkeys(
  scopeId: string,
  form: EventFormState
) {
  const formElement = () => document.getElementById(form.ids.form);

  for (const shortcut of FIELD_SHORTCUTS) {
    registerHotkey({
      hotkey: shortcut.hotkey,
      scopeId,
      description: shortcut.description,
      keyDownHandler: () => {
        const element = formElement();
        const control = shortcut.labels
          .map((label) =>
            element?.querySelector<HTMLElement>(
              `[aria-label="${label}"]:not(:disabled)`
            )
          )
          .find((candidate) => candidate != null);
        if (!control) return false;
        control.focus();
        if (shortcut.open) control.click();
        return true;
      },
      hotkeyToken: shortcut.token,
      runWithInputFocused: true,
      shouldReturnFocusOnClose: false,
    });
  }

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId,
    description: () =>
      form.isEdit() ? t('commands.saveEvent') : t('commands.createEvent'),
    keyDownHandler: () => {
      if (form.formIsDisabled()) return false;
      // A typed time is committed when its field loses focus.
      const active = document.activeElement;
      const field =
        active instanceof HTMLElement && formElement()?.contains(active)
          ? active
          : undefined;
      field?.blur();
      if (!form.controller.canSave()) {
        field?.focus();
        return false;
      }
      form.submit();
      return true;
    },
    hotkeyToken: TOKENS.calendar.composer.save,
    runWithInputFocused: true,
    displayPriority: 10,
  });
}
