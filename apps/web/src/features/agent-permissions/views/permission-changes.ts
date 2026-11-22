import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import type {
  AgentToolPermissions,
  ToolPermissionCatalog,
  ToolPermissionChange,
} from '@service-agent-harness/generated/schemas';
import { TOOL_PERMISSION_REFUSED } from '@service-agent-harness/tool-permissions';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import { actionLabel, stateName } from '../components/labels';
import {
  actionPermission,
  defaultFor,
  groupPermissions,
  toolKey,
} from '../core/model';
import { createPendingChanges } from '../primitives/pending-changes';
import { useSetAgentToolPermissionsMutation } from '../queries/permissions';

/** The server's own explanation of a refusal, when it gave one. */
export function refusalMessage(error: unknown): string | undefined {
  if (!(error instanceof ThrownResultError)) return undefined;
  return error.errors.find((entry) => entry.code === TOOL_PERMISSION_REFUSED)
    ?.message;
}

/** "Email: Send", "Send default", or the tool's label, for the failure toast. */
function changeName(
  catalog: ToolPermissionCatalog,
  change: ToolPermissionChange
): string {
  const target = change.target;
  if (target.kind === 'action') {
    return t('agentPermissions.defaultLabel', {
      action: actionLabel(target.action),
    });
  }
  if (target.kind === 'tool') {
    for (const group of catalog.groups) {
      const tool = group.tools.find(
        (candidate) => toolKey(candidate) === toolKey(target)
      );
      if (tool) return tool.label;
    }
    return toolKey(target);
  }
  const group = catalog.groups.find((entry) => entry.id === target.group);
  return t('agentPermissions.controlLabel', {
    group: group?.name ?? target.group,
    action: actionLabel(target.action),
  });
}

/** The saved state the failed control goes back to. */
function savedState(
  view: AgentToolPermissions | undefined,
  catalog: ToolPermissionCatalog,
  change: ToolPermissionChange
) {
  const target = change.target;
  if (!view) return 'always';
  if (target.kind === 'action') return defaultFor(view, target.action);
  if (target.kind === 'group_action') {
    return (
      actionPermission(groupPermissions(view, target.group), target.action)
        ?.state ?? 'always'
    );
  }
  for (const group of catalog.groups) {
    const tool = group.tools.find(
      (candidate) => toolKey(candidate) === toolKey(target)
    );
    if (!tool) continue;
    const action = actionPermission(
      groupPermissions(view, group.id),
      tool.action
    );
    const override = action?.overrides.find(
      (entry) => toolKey(entry) === toolKey(target)
    );
    return override?.state ?? action?.state ?? 'always';
  }
  return 'always';
}

/** A default and an exception each have their own interaction. */
function interactionName(change: ToolPermissionChange) {
  return match(change.target.kind)
    .with('action', () => 'agent_permissions.set_default')
    .with('group_action', () => 'agent_permissions.set_exception')
    .with('tool', () => 'agent_permissions.set')
    .exhaustive();
}

/**
 * Saving permission controls: one PUT per click, queued per agent, each in
 * its own trace (`agent_permissions.set_default`, `.set_exception`, `.set`
 * for a tool), with a toast naming what didn't
 * save and the state it went back to.
 */
export function usePermissionChanges(options: {
  agentId: Accessor<string>;
  catalog: Accessor<ToolPermissionCatalog>;
  view: Accessor<AgentToolPermissions | undefined>;
}) {
  const mutation = useSetAgentToolPermissionsMutation(options.agentId);

  const save = async (change: ToolPermissionChange) => {
    const interaction = beginInteraction(interactionName(change), {
      attributes: {
        'agent_permissions.target_kind': change.target.kind,
        'agent_permissions.state': change.state ?? 'inherit',
      },
    });
    try {
      return await mutation.mutateAsync({
        agentId: options.agentId(),
        changes: [change],
        trace: interaction.span,
      });
    } finally {
      interaction.end();
    }
  };

  return createPendingChanges({
    save,
    onFailure: (change, error) => {
      const state = savedState(options.view(), options.catalog(), change);
      toast.failure(
        t('agentPermissions.saveFailed', {
          target: changeName(options.catalog(), change),
        }),
        {
          subtext:
            refusalMessage(error) ??
            t('agentPermissions.saveFailedBody', { state: stateName(state) }),
        }
      );
    },
  });
}
