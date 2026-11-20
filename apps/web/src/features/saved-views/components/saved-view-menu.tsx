import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { CopyButton, Dropdown } from '@ui';
import { children, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { savedViewMenuGroups } from '../core/saved-view-menu';

export function SavedViewMenuItems(props: {
  owned: boolean;
  disabled?: boolean;
  mobile?: boolean;
  onEdit: () => void;
  editLabel?: string;
  deleteLabel?: string;
  appearance?: JSX.Element;
  onDuplicate: () => void;
  /** Offered only by consumers whose links can open the view for someone. */
  onCopyLink?: () => void | boolean | Promise<void | boolean>;
  onDelete: () => void;
  /** Present only in lists the viewer can reorder; absent at either end. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const appearance = children(() => props.appearance);
  const groups = () =>
    savedViewMenuGroups({
      owned: props.owned,
      copyLink: Boolean(props.onCopyLink),
      appearance: Boolean(props.appearance),
      moveUp: Boolean(props.onMoveUp),
      moveDown: Boolean(props.onMoveDown),
    });
  const Group = props.mobile ? MobileDrawer.Section : Dropdown.Group;
  const Item = (item: {
    children: JSX.Element;
    disabled?: boolean;
    class?: string;
    onSelect: () => void;
  }) => {
    const content = children(() => item.children);
    return (
      <Show
        when={props.mobile}
        fallback={
          <Dropdown.Item
            disabled={item.disabled}
            class={item.class}
            onSelect={item.onSelect}
          >
            {content()}
          </Dropdown.Item>
        }
      >
        <MobileDrawer.Item
          disabled={item.disabled}
          class={item.class}
          onClick={item.onSelect}
        >
          {content()}
        </MobileDrawer.Item>
      </Show>
    );
  };
  return (
    <div
      class={
        props.mobile
          ? 'flex w-full flex-col gap-2'
          : 'flex w-full flex-col divide-y divide-edge-divider'
      }
    >
      <For each={groups()}>
        {(group) => (
          <Group>
            <For each={group}>
              {(item) =>
                match(item)
                  .with('copy-link', () => (
                    <Show when={props.onCopyLink}>
                      {(onCopyLink) => (
                        <Show
                          when={props.mobile}
                          fallback={
                            <Dropdown.CopyItem
                              icon={<LinkIcon class="size-4" />}
                              disabled={props.disabled}
                              onCopy={onCopyLink()}
                            >
                              {t('entityActions.copyLinkCommand')}
                            </Dropdown.CopyItem>
                          }
                        >
                          <CopyButton
                            as={MobileDrawer.Item}
                            data-saved-view-copy
                            icon={<LinkIcon class="size-4" />}
                            disabled={props.disabled}
                            onClick={onCopyLink()}
                          >
                            {t('entityActions.copyLinkCommand')}
                          </CopyButton>
                        </Show>
                      )}
                    </Show>
                  ))
                  .with('edit', () => (
                    <Item disabled={props.disabled} onSelect={props.onEdit}>
                      <PencilIcon class="size-4" />
                      {props.editLabel ?? t('viewMenus.editView')}
                    </Item>
                  ))
                  .with('appearance', () => appearance())
                  .with('duplicate', () => (
                    <Item
                      disabled={props.disabled}
                      onSelect={props.onDuplicate}
                    >
                      <CopyIcon class="size-4" />
                      {t('viewMenus.duplicate')}
                    </Item>
                  ))
                  .with('move-up', () => (
                    <Show when={props.onMoveUp}>
                      {(onMoveUp) => (
                        <Item disabled={props.disabled} onSelect={onMoveUp()}>
                          <ArrowUpIcon class="size-4" />
                          {t('viewMenus.moveUp')}
                        </Item>
                      )}
                    </Show>
                  ))
                  .with('move-down', () => (
                    <Show when={props.onMoveDown}>
                      {(onMoveDown) => (
                        <Item disabled={props.disabled} onSelect={onMoveDown()}>
                          <ArrowDownIcon class="size-4" />
                          {t('viewMenus.moveDown')}
                        </Item>
                      )}
                    </Show>
                  ))
                  .with('delete', () => (
                    <Item
                      class="text-failure-ink"
                      disabled={props.disabled}
                      onSelect={props.onDelete}
                    >
                      <TrashIcon class="size-4" />
                      {props.deleteLabel ?? t('viewMenus.deleteView')}
                    </Item>
                  ))
                  .exhaustive()
              }
            </For>
          </Group>
        )}
      </For>
    </div>
  );
}
