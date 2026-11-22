import { t } from '@app/lib/i18n';
import type {
  PermissionAction,
  ToolPermissionCatalog,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import { createSignal, For, Show } from 'solid-js';
import {
  ACTION_ORDER,
  actionTarget,
  addableEntities,
  changeForDefault,
  changeForException,
  defaultFor,
  exceptionsFor,
  followingCount,
  type PendingLookup,
  type ToolSetting,
  toolSettingsFor,
  toolTarget,
} from '../core/model';
import type {
  PermissionChange,
  PermissionsView,
} from '../queries/permissions-view';
import { ActionAccordion } from './action-accordion';
import { actionLabel } from './labels';

/**
 * Tool permissions: a default per action (Read, Create, Edit, Send, Delete)
 * and per-entity exceptions to it. Each control shows its saving state
 * (`pendingState`) until the server answers; `onChange` sends a change and
 * the state to show meanwhile.
 */
export function ToolPermissions(props: {
  catalog: ToolPermissionCatalog;
  view: PermissionsView;
  editable: boolean;
  /** Shows the "Tool permissions" title and its description. */
  heading?: boolean;
  /** The action to show expanded at first, e.g. from a link. */
  initialAction?: PermissionAction;
  pendingState: PendingLookup;
  onChange: (change: PermissionChange, shown: ToolPermissionState) => void;
}) {
  const [expanded, setExpanded] = createSignal<PermissionAction[]>(
    props.initialAction ? [props.initialAction] : []
  );

  const toggle = (action: PermissionAction) =>
    setExpanded((current) =>
      current.includes(action)
        ? current.filter((entry) => entry !== action)
        : [...current, action]
    );

  const defaultState = (action: PermissionAction) =>
    props.pendingState(actionTarget(action)) ?? defaultFor(props.view, action);

  const exceptions = (action: PermissionAction) =>
    exceptionsFor(props.catalog, props.view, action, props.pendingState);

  const setDefault = (action: PermissionAction, state: ToolPermissionState) =>
    props.onChange(changeForDefault(action, state), state);

  const setException = (
    action: PermissionAction,
    group: string,
    state: ToolPermissionState | null
  ) =>
    props.onChange(
      changeForException(group, action, state),
      state ?? defaultState(action)
    );

  const removeTool = (setting: ToolSetting) =>
    props.onChange(
      { target: toolTarget(setting.tool), state: null },
      setting.rule.state
    );

  return (
    <div class="@container flex flex-col">
      <Show when={props.heading}>
        <h3 class="text-xl font-semibold text-ink">
          {t('agentPermissions.toolPermissionsTitle')}
        </h3>
        <p class="mt-1.5 mb-5 text-sm text-ink-muted">
          {t('agentPermissions.toolPermissionsDescription')}
        </p>
      </Show>
      <div class="flex flex-col rounded-2xl border border-edge-muted bg-panel px-4.5 pt-2 pb-3 @max-md:px-3">
        <div
          aria-hidden="true"
          class="flex h-8.5 items-center gap-3 border-b border-edge-muted text-[13px] text-ink-muted"
        >
          <span class="flex-1">{t('agentPermissions.actionHeader')}</span>
          <span class="w-44 shrink-0 @max-md:w-32">
            {t('agentPermissions.defaultHeader')}
          </span>
        </div>
        <div class="flex flex-col divide-y divide-edge-muted">
          <For each={ACTION_ORDER}>
            {(action) => (
              <ActionAccordion
                action={action}
                name={actionLabel(action)}
                defaultState={defaultState(action)}
                exceptions={exceptions(action)}
                addable={addableEntities(
                  props.catalog,
                  action,
                  exceptions(action)
                )}
                following={followingCount(
                  props.catalog,
                  action,
                  exceptions(action)
                )}
                toolSettings={toolSettingsFor(
                  props.catalog,
                  props.view,
                  action
                )}
                editable={props.editable}
                open={expanded().includes(action)}
                onToggle={() => toggle(action)}
                onDefault={(state) => setDefault(action, state)}
                onException={(group, state) =>
                  setException(action, group, state)
                }
                onRemoveTool={removeTool}
                removingTool={(setting) =>
                  props.pendingState(toolTarget(setting.tool)) !== undefined
                }
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
