import type {
  EntityActionListState,
  EntityActionNavigationHandler,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  CopyMenuItem,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import { NotificationMuteMenu } from '@notifications/components/NotificationMuteMenu';
import { NotificationSettingsMenu } from '@notifications/components/NotificationSettingsMenu';
import { Key } from '@solid-primitives/keyed';
import {
  type Component,
  type ComponentProps,
  children,
  createMemo,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  createSoupEntityActions,
  viewedProjectIdFromContent,
} from './createSoupEntityActions';

interface SoupEntityActionsMenuProps {
  entities: EntityData[];
  list: EntityActionListState;
  item?: Component<ComponentProps<typeof MenuItem>>;
  copyItem?: Component<ComponentProps<typeof CopyMenuItem>>;
  separator?: Component;
  viewContext: EntityActionViewContext;
  /**
   * Closes the host menu when an embedded picker (`menuItem`) is done with
   * it. Plain and mute items close the menu on select themselves, so this is
   * not called after them: it would land on the dialog or picker the item
   * opened, or on the menu opened again while the item was still saving.
   */
  onActionComplete?: () => void;
  onEditTags?: () => void;
  onSetProject?: () => void;
  /** Host-specific items shown after the entity actions. */
  extraItems?: JSX.Element;
  /** A list that completes its own rows, such as Home's work feed. */
  markDoneDelegate?: () => MarkDoneDelegate | undefined;
  /** Where the view moves after an action that removes the row. */
  createActionNavigationHandler?: () =>
    | EntityActionNavigationHandler
    | undefined;
  /** The folder the list shows, when the split's content doesn't say. */
  viewedProjectId?: string;
}

export const SoupEntityActionsMenu = (props: SoupEntityActionsMenuProps) => {
  const Item = props.item ?? MenuItem;
  const CopyItem = props.copyItem ?? CopyMenuItem;
  const Separator = props.separator ?? MenuSeparator;
  const panel = useSplitPanelOrThrow();
  const { buildActionGroups } = createSoupEntityActions({
    markDoneDelegate: () => props.markDoneDelegate?.(),
    selectedEntities: () => props.entities,
  });
  // Resolved rather than tested as JSX: a host whose items render nothing
  // (label rows behind a flag, say) still passes a truthy element, and
  // separating on that alone leaves a divider under the last action.
  const extraItems = children(() => props.extraItems);
  const hasExtraItems = () => extraItems.toArray().length > 0;

  const groups = createMemo(() => {
    const content = panel.handle.content();
    return buildActionGroups(props.list, props.entities, {
      viewContext: props.viewContext,
      viewedProjectId:
        props.viewedProjectId ?? viewedProjectIdFromContent(content),
      openTagPicker: props.onEditTags,
      openProjectPicker: props.onSetProject,
      splitHandle: panel.handle,
      createActionNavigationHandler: props.createActionNavigationHandler,
    });
  });

  // Async so an item that throws is reported like one that rejects, and
  // the menu still closes.
  const runAction = async (onClick: () => void | Promise<unknown>) => {
    await onClick();
  };

  return (
    <>
      <Key each={groups()} by="id">
        {(group, groupIndex) => (
          <>
            <Show when={groupIndex() > 0}>
              <Separator />
            </Show>
            <Key each={group().items} by="id">
              {(action) => {
                return (
                  <Show
                    when={action().notificationSettingsMenu}
                    fallback={
                      <Show
                        when={action().menuItem}
                        fallback={
                          <Show
                            when={action().muteMenu}
                            fallback={
                              <Show
                                when={action().copy}
                                fallback={
                                  <Item
                                    text={action().label}
                                    icon={action().icon}
                                    hotkeyToken={action().hotkeyToken}
                                    shortcut={action().shortcut}
                                    disabled={action().disabled}
                                    onClick={() =>
                                      fireAndForget(
                                        runAction(action().onClick),
                                        'entity-actions'
                                      )
                                    }
                                    class={
                                      action().destructive
                                        ? 'text-failure-ink'
                                        : undefined
                                    }
                                  />
                                }
                              >
                                <CopyItem
                                  text={action().label}
                                  icon={action().icon}
                                  hotkeyToken={action().hotkeyToken}
                                  shortcut={action().shortcut}
                                  disabled={action().disabled}
                                  onCopy={async () =>
                                    (await action().onClick()) !== false
                                  }
                                />
                              </Show>
                            }
                          >
                            <NotificationMuteMenu {...action().muteMenu!} />
                          </Show>
                        }
                      >
                        {(component) => (
                          <Dynamic
                            component={component()}
                            onActionComplete={props.onActionComplete}
                          />
                        )}
                      </Show>
                    }
                  >
                    {(menu) => (
                      <NotificationSettingsMenu
                        {...menu()}
                        onActionComplete={props.onActionComplete}
                      />
                    )}
                  </Show>
                );
              }}
            </Key>
          </>
        )}
      </Key>
      <Show when={hasExtraItems()}>
        <Show when={groups().length > 0}>
          <Separator />
        </Show>
        {extraItems()}
      </Show>
    </>
  );
};
