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
import type { EntityData } from '@entity';
import { NotificationMuteMenu } from '@notifications/components/NotificationMuteMenu';
import { Key } from '@solid-primitives/keyed';
import { children, createMemo, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  createSoupEntityActions,
  viewedProjectIdFromContent,
} from './createSoupEntityActions';

interface SoupEntityActionsMenuProps {
  entities: EntityData[];
  list: EntityActionListState;
  viewContext: EntityActionViewContext;
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

  const handleAction = async (onClick: () => void | Promise<unknown>) => {
    await onClick();
    props.onActionComplete?.();
  };

  return (
    <>
      <Key each={groups()} by="id">
        {(group, groupIndex) => (
          <>
            <Show when={groupIndex() > 0}>
              <MenuSeparator />
            </Show>
            <Key each={group().items} by="id">
              {(action) => {
                return (
                  <Show
                    when={action().menuItem}
                    fallback={
                      <Show
                        when={action().muteMenu}
                        fallback={
                          <Show
                            when={action().copy}
                            fallback={
                              <MenuItem
                                text={action().label}
                                icon={action().icon}
                                hotkeyToken={action().hotkeyToken}
                                shortcut={action().shortcut}
                                disabled={action().disabled}
                                onClick={() => handleAction(action().onClick)}
                                class={
                                  action().destructive
                                    ? 'text-failure-ink'
                                    : undefined
                                }
                              />
                            }
                          >
                            <CopyMenuItem
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
                        <NotificationMuteMenu
                          {...action().muteMenu!}
                          onActionComplete={props.onActionComplete}
                        />
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
                );
              }}
            </Key>
          </>
        )}
      </Key>
      <Show when={hasExtraItems()}>
        <Show when={groups().length > 0}>
          <MenuSeparator />
        </Show>
        {extraItems()}
      </Show>
    </>
  );
};
