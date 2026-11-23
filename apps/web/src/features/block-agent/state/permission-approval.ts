/**
 * The wire shapes agent permissions put in a session: the arguments of a
 * permission hold (a `macro-sdk` tool approval), the `permission` record of
 * an `ExecuteCode` call the permissions blocked or a person declined, and a
 * `ShowPermissions` call. Each is parsed at this boundary, so a shape this
 * build doesn't know renders as the ordinary call it would otherwise be.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import {
  type ExecutionPermission,
  type GatedOperation,
  PermissionAction,
  type ShowPermissionsSelection,
  ToolPermissionOrigin,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import { z } from 'zod';

/** The approval server slug of a hold on the agent's permissions. */
export const PERMISSION_HOLD_SLUG = 'macro-sdk';

/**
 * A hold on the agent's permissions in the transcript. It shows nothing
 * there: the pending one docks above the composer, and once answered the
 * program's own row says whether it ran.
 */
export function isPermissionHold(part: MessagePart | undefined): boolean {
  return (
    part?.kind === 'tool_approval' && part.serverSlug === PERMISSION_HOLD_SLUG
  );
}

// The generated enums, so a value the server adds (an action default's
// `action` origin) parses here too instead of hiding the whole hold.
const PERMISSION_ACTION = z.enum(PermissionAction);

const gatedOperationSchema = z.object({
  service: z.string(),
  operation: z.string(),
  label: z.string(),
  group: z.string(),
  groupName: z.string(),
  action: PERMISSION_ACTION.nullish(),
  state: z.enum(ToolPermissionState),
  origin: z.enum(ToolPermissionOrigin),
}) satisfies z.ZodType<GatedOperation>;

const permissionHoldSchema = z.object({
  source: z.string().optional(),
  module: z.string().optional(),
  permission: z.object({
    executionId: z.string().nullish(),
    operations: z.array(gatedOperationSchema),
  }),
});

const executionPermissionSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('blocked'),
    operations: z.array(gatedOperationSchema),
  }),
  z.object({
    outcome: z.literal('declined'),
    status: z.enum(['denied', 'cancelled', 'expired']),
    operations: z.array(gatedOperationSchema),
  }),
]) satisfies z.ZodType<ExecutionPermission>;

const showPermissionsInputSchema = z.object({
  groups: z
    .array(
      z.object({
        group: z.string(),
        actions: z.array(PERMISSION_ACTION).optional(),
      })
    )
    .optional(),
  tools: z
    .array(z.object({ service: z.string(), operation: z.string() }))
    .optional(),
  reason: z.string().nullish(),
});

const showPermissionsResultSchema = z.object({
  agentId: z.string(),
  selection: z.object({
    groups: z.array(
      z.object({
        group: z.string(),
        actions: z.array(PERMISSION_ACTION).optional(),
      })
    ),
    tools: z.array(z.object({ service: z.string(), operation: z.string() })),
  }),
  reason: z.string().nullish(),
});

export type PermissionHold = {
  /** The program. */
  source?: string;
  /** The TypeScript module beside it, shown with it; it reaches no network. */
  module?: string;
  /** The operations set to Ask that it may call. */
  operations: GatedOperation[];
};

/** A permission hold's program and operations, from its approval arguments. */
export function parsePermissionHold(args: unknown): PermissionHold | undefined {
  const parsed = permissionHoldSchema.safeParse(args);
  if (!parsed.success) return undefined;
  return {
    source: parsed.data.source,
    module: parsed.data.module,
    operations: parsed.data.permission.operations,
  };
}

/** Why a program didn't run because of its permissions, when it didn't. */
export function parseExecutionPermission(
  raw: unknown
): ExecutionPermission | undefined {
  if (raw === null || raw === undefined) return undefined;
  const parsed = executionPermissionSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Only Macro's session-authenticated internal server may select this card. */
export function isShowPermissions(part: MessagePart): boolean {
  return (
    part.kind === 'tool_use' &&
    part.name.kind === 'mcp' &&
    part.name.server === 'macro_internal' &&
    part.name.tool === 'ShowPermissions'
  );
}

export type ShowPermissionsCall = {
  selection: ShowPermissionsSelection;
  reason?: string;
  /** Present once the server answered. */
  agentId?: string;
};

/**
 * What a ShowPermissions call asks to show: the server's normalized
 * selection once it answered, else the agent's own arguments.
 */
export function parseShowPermissions(
  part: MessagePart
): ShowPermissionsCall | undefined {
  if (part.kind !== 'tool_use') return undefined;
  const detail = part.detail;
  const output =
    detail.kind === 'other'
      ? (detail.result ?? detail.output)
      : detail.kind === 'macro'
        ? detail.output
        : undefined;
  const result = showPermissionsResultSchema.safeParse(output);
  if (result.success) {
    return {
      selection: result.data.selection,
      reason: result.data.reason ?? undefined,
      agentId: result.data.agentId,
    };
  }
  const input = 'input' in detail ? detail.input : undefined;
  const asked = showPermissionsInputSchema.safeParse(input);
  if (!asked.success) return undefined;
  return {
    selection: {
      groups: asked.data.groups ?? [],
      tools: asked.data.tools ?? [],
    },
    reason: asked.data.reason ?? undefined,
  };
}
