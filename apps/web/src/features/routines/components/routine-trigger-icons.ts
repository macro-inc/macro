import GithubIcon from '@icon/mcp-github.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file-text.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import MapPinIcon from '@icon/system/regular/map-pin.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import type { Component } from 'solid-js';
import { match } from 'ts-pattern';
import type { RoutineEventGroup, TriggerKind } from '../core/routine-triggers';

/** The groups the trigger menu lists: time, places, then Macro activity. */
export type TriggerGroup = 'Schedule' | 'Places' | RoutineEventGroup;

/** One icon per kind of trigger, wherever triggers are shown. */
export const TRIGGER_GROUP_ICONS: Record<
  TriggerGroup,
  Component<{ class?: string }>
> = {
  Schedule: ClockIcon,
  Places: MapPinIcon,
  Email: EnvelopeIcon,
  Tasks: CheckCircleIcon,
  Channels: HashIcon,
  Documents: FileIcon,
  Calls: PhoneIcon,
  GitHub: GithubIcon,
};

/** The icon for a routine's first trigger, as the routines list shows it. */
export function triggerKindIcon(
  kind: TriggerKind | undefined
): Component<{ class?: string }> {
  return TRIGGER_GROUP_ICONS[
    match(kind)
      .returnType<TriggerGroup>()
      .with('email', () => 'Email')
      .with('task', () => 'Tasks')
      .with('document', () => 'Documents')
      .with('channel', () => 'Channels')
      .with('call', () => 'Calls')
      .with('github', () => 'GitHub')
      .with('location', () => 'Places')
      .with('schedule', undefined, () => 'Schedule')
      .exhaustive()
  ];
}
