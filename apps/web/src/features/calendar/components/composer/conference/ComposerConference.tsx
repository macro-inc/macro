import { t } from '@app/lib/i18n';
import MacroLogo from '@icon/macro-logo.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import type { CalendarCapabilities } from '@service-calendar/generated/schemas/calendarCapabilities';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { createComposerConference } from '../../../primitives/create-composer-conference';
import type { EventEditorConferenceChoice } from '../event-form-model';

export interface ComposerConferenceProps {
  provider?: CalendarCapabilities['conferenceProvider'];
  value: EventEditorConferenceChoice;
  canKeepExisting: boolean;
  macroCallsEnabled: boolean;
  onChange: (value: EventEditorConferenceChoice) => void;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
}

export function ComposerConference(props: ComposerConferenceProps) {
  const conference = createComposerConference({
    provider: () => props.provider,
    value: () => props.value,
    macroCallsEnabled: () => props.macroCallsEnabled,
    canKeepExisting: () => props.canKeepExisting,
    disabled: () => props.disabled ?? false,
    onChange: (value) => props.onChange(value),
  });
  const label = () =>
    props.value === 'none'
      ? t('calendar.addMeetingLink')
      : (conference.selected()?.label ?? t('calendar.addMeetingLink'));
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant={props.fullWidth ? 'row' : 'value'}
        finish="flat"
        size={props.fullWidth ? 'sheet-row' : (props.size ?? 'sm')}
        fullWidth={props.fullWidth}
        class={props.fullWidth ? 'justify-between' : undefined}
        classList={{ 'text-ink-subtle': props.value === 'none' }}
        aria-label={t('calendar.conferencing')}
        disabled={props.disabled}
      >
        <Show when={props.value === 'macro'}>
          <MacroLogo class="size-3.5 text-ink-muted" />
        </Show>
        <span
          class={
            props.fullWidth ? 'min-w-0 flex-1 truncate text-left' : undefined
          }
        >
          {label()}
        </span>
        <CaretDownIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-48">
        <Dropdown.Group>
          <Dropdown.RadioGroup value={props.value} onChange={conference.choose}>
            <For each={conference.choices()}>
              {(choice) => (
                <Dropdown.RadioItem value={choice.value} closeOnSelect>
                  <Show when={choice.value === 'macro'}>
                    <MacroLogo class="size-3.5 text-ink-muted" />
                  </Show>
                  <span class="flex-1">{choice.label}</span>
                  <Dropdown.ItemIndicator />
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
