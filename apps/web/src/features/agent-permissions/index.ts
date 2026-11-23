export { GatedOperationList } from './components/gated-operation-list';
export {
  describeGatedThings,
  gatedThingsTitle,
  type PhrasePart,
  permissionRequestParts,
} from './components/gated-phrases';
export { gatedFocus } from './core/gated-operations';
export type { PermissionFocus } from './core/model';
export { useSessionToolPermissionsQuery } from './queries/permissions';
export { useAgentPermissionsAvailable } from './use-agent-permissions-available';
export { useAgentPermissionsFlag } from './use-agent-permissions-flag';
export {
  applyPermissionsDraft,
  EditAgentPermissions,
  NewAgentPermissions,
  type PermissionsDraft,
} from './views/agent-permissions-form';
export { AgentPermissionsPanel } from './views/agent-permissions-panel';
export { BlockedPermissionsNotice } from './views/blocked-permissions-notice';
export { useOpenAgentPermissions } from './views/open-agent-permissions';
export { refusalMessage } from './views/permission-changes';
export { ShowPermissionsCard } from './views/show-permissions-card';
