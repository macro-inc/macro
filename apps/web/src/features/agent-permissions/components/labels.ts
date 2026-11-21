import { t } from '@app/lib/i18n';
import type {
  PermissionAction,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import { match } from 'ts-pattern';

/** The short label on the state control. */
export function stateLabel(state: ToolPermissionState): string {
  return match(state)
    .with('always', () => t('agentPermissions.allow'))
    .with('ask', () => t('agentPermissions.ask'))
    .with('never', () => t('agentPermissions.never'))
    .exhaustive();
}

/** The full state name, for prose and tooltips. */
export function stateName(state: ToolPermissionState): string {
  return match(state)
    .with('always', () => t('agentPermissions.alwaysAllow'))
    .with('ask', () => t('agentPermissions.askPermission'))
    .with('never', () => t('agentPermissions.neverAllow'))
    .exhaustive();
}

export function stateHint(state: ToolPermissionState): string {
  return match(state)
    .with('always', () => t('agentPermissions.allowHint'))
    .with('ask', () => t('agentPermissions.askHint'))
    .with('never', () => t('agentPermissions.neverHint'))
    .exhaustive();
}

/** "Asks before sending", for a collapsed group's summary. */
export function asksPhrase(action: PermissionAction): string {
  return match(action)
    .with('create', () => t('agentPermissions.asksBeforeCreating'))
    .with('read', () => t('agentPermissions.asksBeforeReading'))
    .with('update', () => t('agentPermissions.asksBeforeUpdating'))
    .with('destroy', () => t('agentPermissions.asksBeforeDeleting'))
    .with('send', () => t('agentPermissions.asksBeforeSending'))
    .exhaustive();
}

/** "Never sends", for a collapsed group's summary. */
export function neverPhrase(action: PermissionAction): string {
  return match(action)
    .with('create', () => t('agentPermissions.neverCreates'))
    .with('read', () => t('agentPermissions.neverReads'))
    .with('update', () => t('agentPermissions.neverUpdates'))
    .with('destroy', () => t('agentPermissions.neverDeletes'))
    .with('send', () => t('agentPermissions.neverSends'))
    .exhaustive();
}
