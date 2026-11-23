import registryJson from '@agent-permission-registry';
import { z } from 'zod';

/**
 * Agent permissions' operation registry, read from the same checked-in file
 * the backend uses (`crates/agent_permission_registry/registry.json`): every
 * SDK operation's permission group, action and label, keyed by service and
 * operationId.
 */

const ACTIONS = ['create', 'read', 'update', 'destroy', 'send'] as const;

const REGISTRY_SCHEMA = z.object({
  groups: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string() })
  ),
  operations: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        group: z.string(),
        action: z.enum(ACTIONS),
        label: z.string(),
      })
    )
  ),
});

type Registry = z.infer<typeof REGISTRY_SCHEMA>;

export type PermissionAction = (typeof ACTIONS)[number];

export type PermissionGroup = Registry['groups'][number];

export type PermissionOperation = {
  service: string;
  operationId: string;
  group: string;
  action: PermissionAction;
  label: string;
};

const REGISTRY: Registry = REGISTRY_SCHEMA.parse(registryJson);

const OPERATIONS: PermissionOperation[] = Object.entries(
  REGISTRY.operations
).flatMap(([service, operations]) =>
  Object.entries(operations).map(([operationId, entry]) => ({
    service,
    operationId,
    ...entry,
  }))
);

/** The five actions, in display order. */
export const PERMISSION_ACTIONS: readonly PermissionAction[] = ACTIONS;

/** Every group, in display order. */
export function permissionGroups(): PermissionGroup[] {
  return REGISTRY.groups;
}

/** The operations in a group, sorted by label: a group's custom view. */
export function groupOperations(groupId: string): PermissionOperation[] {
  return OPERATIONS.filter((operation) => operation.group === groupId).sort(
    (a, b) => a.label.localeCompare(b.label)
  );
}

/** One operation's classification, or undefined when it is not classified. */
export function permissionOperation(
  service: string,
  operationId: string
): PermissionOperation | undefined {
  const entry = REGISTRY.operations[service]?.[operationId];
  if (!entry) return undefined;
  return { service, operationId, ...entry };
}
