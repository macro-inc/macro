import GithubIcon from '@icon/mcp-github.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file-text.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import type { Component } from 'solid-js';
import { match } from 'ts-pattern';
import type { RoutineEventGroup, TriggerKind } from '../core/routine-triggers';

/** One icon per kind of trigger, wherever triggers are shown. */
export const TRIGGER_GROUP_ICONS: Record<
  'Schedule' | RoutineEventGroup,
  Component<{ class?: string }>
> = {
  Schedule: ClockIcon,
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
      .returnType<'Schedule' | RoutineEventGroup>()
      .with('email', () => 'Email')
      .with('task', () => 'Tasks')
      .with('document', () => 'Documents')
      .with('channel', () => 'Channels')
      .with('call', () => 'Calls')
      .with('github', () => 'GitHub')
      .with('schedule', undefined, () => 'Schedule')
      .exhaustive()
  ];
}
