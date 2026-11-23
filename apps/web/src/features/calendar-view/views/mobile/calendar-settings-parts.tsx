import { SettingsSelect } from '@app/features/settings/components/settings-select';
import { ToggleSwitch } from '@ui';
import type { JSX } from 'solid-js';

export function CalendarSettingsGroup(props: {
  title: string;
  children: JSX.Element;
}) {
  return (
    <section class="flex flex-col gap-3" aria-label={props.title}>
      <h2 class="px-4 text-xs font-medium text-ink-extra-muted">
        {props.title}
      </h2>
      <div class="bg-surface rounded-4xl p-1">{props.children}</div>
    </section>
  );
}

export function CalendarSettingsRow(props: {
  label?: string;
  children: JSX.Element;
}) {
  return (
    <div class="flex min-h-14 min-w-0 items-center justify-between gap-3 px-4 py-2">
      {props.label && <span class="min-w-0 text-base">{props.label}</span>}
      {props.children}
    </div>
  );
}

export function CalendarSettingsSwitch(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <CalendarSettingsRow label={props.label}>
      <ToggleSwitch
        label={props.label}
        labelClass="sr-only"
        size="md"
        checked={props.checked}
        onChange={props.onChange}
      />
    </CalendarSettingsRow>
  );
}

export function CalendarSettingsSelect(props: {
  label: string;
  value?: string;
  options: { id: string; name: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <CalendarSettingsRow label={props.label}>
      <SettingsSelect
        {...props}
        class="min-w-0 max-w-[55%]"
        triggerClass="settings-input border-0 bg-transparent text-ink-muted shadow-none"
      />
    </CalendarSettingsRow>
  );
}
