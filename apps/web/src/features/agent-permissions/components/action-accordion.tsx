import { t } from '@app/lib/i18n';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import type {
  PermissionAction,
  ToolPermissionCatalogGroup,
  ToolPermissionRule,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import { cn } from '@ui';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import type { Exception, ToolSetting } from '../core/model';
import { EntityPicker } from './entity-picker';
import { ExceptionRow } from './exception-row';
import { PermissionStateControl } from './permission-state-control';
import { RestrictionMarker } from './restriction-marker';
import { ToolSettingsList } from './tool-settings-list';

/**
 * One action of the Tool permissions table: its name, how many exceptions
 * and tool settings it has, and its default. Expanded, it lists the
 * exceptions, the entities following the default, "+ Add exception", and
 * any saved tool settings.
 */
export function ActionAccordion(props: {
  action: PermissionAction;
  /** Read, Create, Edit, Send or Delete. */
  name: string;
  defaultState: ToolPermissionState;
  exceptions: Exception[];
  /** Entities with tools for the action and no exception. */
  addable: ToolPermissionCatalogGroup[];
  /** How many entities with tools for the action follow its default. */
  following: number;
  toolSettings: ToolSetting[];
  editable: boolean;
  /** A follower's own restrictions: on the default, and on each entity. */
  restrictions?: {
    onDefault?: ToolPermissionRule;
    onEntity: (group: string) => ToolPermissionRule | undefined;
    /** Removes one, when the viewer may. */
    onRemove?: (rule: ToolPermissionRule) => void;
  };
  /** Saved tool settings can be removed. */
  toolsRemovable: boolean;
  open: boolean;
  onToggle: () => void;
  onDefault: (state: ToolPermissionState) => void;
  onException: (group: string, state: ToolPermissionState | null) => void;
  onRemoveTool: (setting: ToolSetting) => void;
  removingTool: (setting: ToolSetting) => boolean;
}) {
  const panelId = createUniqueId();
  // An entity picked from "+ Add exception" whose state isn't chosen yet.
  const [adding, setAdding] = createSignal<ToolPermissionCatalogGroup>();

  const addable = () =>
    props.addable.filter((group) => group.id !== adding()?.id);

  const pick = (groupId: string) => {
    setAdding(props.addable.find((group) => group.id === groupId));
  };

  const chooseNew = (state: ToolPermissionState | null) => {
    const group = adding();
    setAdding(undefined);
    // ✕ on a new exception just cancels it.
    if (group && state !== null) props.onException(group.id, state);
  };

  const followLine = () => {
    const action = props.name;
    if (props.following === 0) return undefined;
    if (props.exceptions.length === 0) {
      return t('agentPermissions.allFollow', {
        count: props.following,
        action,
      });
    }
    return t('agentPermissions.othersFollow', {
      count: props.following,
      action,
    });
  };

  return (
    <div class="flex flex-col">
      {/* On touch the control is full width, so it wraps under the name. */}
      <div class="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 py-2">
        <button
          type="button"
          class="flex min-h-8 min-w-0 flex-1 basis-40 flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-expanded={props.open}
          aria-controls={panelId}
          onClick={() => props.onToggle()}
        >
          <CaretRightIcon
            aria-hidden="true"
            class={cn(
              'size-3.5 shrink-0 text-ink-muted transition-transform',
              props.open && 'rotate-90'
            )}
          />
          <span class="text-sm font-medium text-ink">{props.name}</span>
          <Show
            when={props.exceptions.length > 0 || props.toolSettings.length > 0}
          >
            <span class="ml-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
              <Show when={props.exceptions.length > 0}>
                <span>
                  {t('agentPermissions.exceptionCount', {
                    count: props.exceptions.length,
                  })}
                </span>
              </Show>
              <Show
                when={
                  props.exceptions.length > 0 && props.toolSettings.length > 0
                }
              >
                <span aria-hidden="true">·</span>
              </Show>
              <Show when={props.toolSettings.length > 0}>
                <span>
                  {t('agentPermissions.toolSettingCount', {
                    count: props.toolSettings.length,
                  })}
                </span>
              </Show>
            </span>
          </Show>
        </button>
        <Show when={props.restrictions?.onDefault}>
          {(rule) => (
            <RestrictionMarker
              rule={rule()}
              target={t('agentPermissions.defaultLabel', {
                action: props.name,
              })}
              onRemove={
                props.restrictions?.onRemove
                  ? () => props.restrictions?.onRemove?.(rule())
                  : undefined
              }
            />
          )}
        </Show>
        <div class="ml-auto shrink-0 touch:w-full">
          <PermissionStateControl
            label={t('agentPermissions.defaultMenu', { action: props.name })}
            value={props.defaultState}
            disabled={!props.editable}
            onChange={props.onDefault}
          />
        </div>
      </div>
      <Show when={props.open}>
        <section
          id={panelId}
          aria-label={t('agentPermissions.exceptionsTitle', {
            action: props.name,
          })}
          class="flex flex-col border-t border-edge-muted pt-2.5 pb-3.5 pl-6 @max-md:pl-2"
        >
          <div class="flex min-h-8 items-center justify-between gap-2">
            <h4 class="text-[13px] font-medium text-ink">
              {t('agentPermissions.exceptionsTitle', { action: props.name })}
            </h4>
            <Show when={props.editable}>
              <EntityPicker
                label={t('agentPermissions.addExceptionFor', {
                  action: props.name,
                })}
                entities={addable()}
                onPick={pick}
              />
            </Show>
          </div>
          {/* Rows are keyed by their catalog group, which keeps its identity
              while states change, so a save never remounts an open menu. */}
          <For each={props.exceptions.map((exception) => exception.group)}>
            {(group) => {
              const state = () =>
                props.exceptions.find((entry) => entry.group.id === group.id)
                  ?.state;
              return (
                <ExceptionRow
                  group={group.id}
                  name={group.name}
                  label={t('agentPermissions.controlLabel', {
                    group: group.name,
                    action: props.name,
                  })}
                  state={state()}
                  defaultState={props.defaultState}
                  editable={props.editable}
                  marker={
                    <Show when={props.restrictions?.onEntity(group.id)}>
                      {(rule) => (
                        <RestrictionMarker
                          rule={rule()}
                          target={t('agentPermissions.controlLabel', {
                            group: group.name,
                            action: props.name,
                          })}
                          onRemove={
                            props.restrictions?.onRemove
                              ? () => props.restrictions?.onRemove?.(rule())
                              : undefined
                          }
                        />
                      )}
                    </Show>
                  }
                  onSelect={(next) => {
                    if (next !== state()) props.onException(group.id, next);
                  }}
                />
              );
            }}
          </For>
          <Show when={adding()} keyed>
            {(group) => (
              <ExceptionRow
                group={group.id}
                name={group.name}
                label={t('agentPermissions.controlLabel', {
                  group: group.name,
                  action: props.name,
                })}
                defaultState={props.defaultState}
                editable={props.editable}
                onSelect={chooseNew}
              />
            )}
          </Show>
          <Show when={followLine()}>
            {(line) => (
              <p class="mt-1.5 text-[13px] text-ink-muted">{line()}</p>
            )}
          </Show>
          <Show
            when={
              props.exceptions.length === 0 &&
              props.following === 0 &&
              !adding()
            }
          >
            <p class="mt-1.5 text-[13px] text-ink-muted">
              {t('agentPermissions.noTools')}
            </p>
          </Show>
          <Show when={props.toolSettings.length > 0}>
            <ToolSettingsList
              settings={props.toolSettings}
              removable={props.toolsRemovable}
              removing={props.removingTool}
              onRemove={props.onRemoveTool}
            />
          </Show>
        </section>
      </Show>
    </div>
  );
}
