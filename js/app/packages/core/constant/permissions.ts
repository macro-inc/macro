/**
 * RBAC permission identifiers, mirroring the backend `PermissionId` enum
 * (rust/cloud-storage/roles_and_permissions/src/domain/model.rs). The user's
 * granted permissions are exposed on the frontend via `usePermissions()` /
 * `useHasPermission()` in `@core/context/user`.
 *
 * Prefer referencing these constants over hardcoding the raw permission strings.
 */
export const PERMISSION_IDS = {
  WRITE_STRIPE_SUBSCRIPTION: 'write:stripe_subscription',
  READ_PROFESSIONAL_FEATURES: 'read:professional_features',
  WRITE_RELEASE_EMAIL: 'write:release_email',
  WRITE_ADMIN_PANEL: 'write:admin_panel',
  WRITE_ENTERPRISE_SUBSCRIPTIONS: 'write:enterprise_subscriptions',
  WRITE_DISCOUNT: 'write:discount',
  WRITE_IT_PANEL: 'write:it_panel',
  WRITE_EMAIL_TOOL: 'write:email_tool',
  WRITE_AI_FEATURES: 'write:ai_features',
  READ_DOCX_EDITOR: 'read:docx_editor',
  WRITE_HAIKU: 'write:haiku',
  WRITE_SONNET: 'write:sonnet',
  WRITE_OPUS: 'write:opus',
} as const;

export type PermissionId = (typeof PERMISSION_IDS)[keyof typeof PERMISSION_IDS];
