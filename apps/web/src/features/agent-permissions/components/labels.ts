import { t } from '@app/lib/i18n';
import type {
  PermissionAction,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import { match } from 'ts-pattern';

/** The short label on a state control: Allow, Ask, Deny. */
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

/** An action's name: Read, Create, Edit, Send, Delete. */
export function actionLabel(action: PermissionAction): string {
  return match(action)
    .with('read', () => t('agentPermissions.actionRead'))
    .with('create', () => t('agentPermissions.actionCreate'))
    .with('update', () => t('agentPermissions.actionEdit'))
    .with('send', () => t('agentPermissions.actionSend'))
    .with('destroy', () => t('agentPermissions.actionDelete'))
    .exhaustive();
}
