import { t } from '@app/lib/i18n';
import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { savedViewMenuGroups } from '../core/saved-view-menu';

export function SavedViewMenuItems(props: {
  owned: boolean;
  disabled?: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  /** Offered only by consumers whose links can open the view for someone. */
  onCopyLink?: () => void | boolean | Promise<void | boolean>;
  onDelete: () => void;
  /** Present only in lists the viewer can reorder; absent at either end. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const groups = () =>
    savedViewMenuGroups({
      owned: props.owned,
      copyLink: Boolean(props.onCopyLink),
      moveUp: Boolean(props.onMoveUp),
      moveDown: Boolean(props.onMoveDown),
    });
  return (
    <div class="flex w-full flex-col divide-y divide-edge-divider">
      <For each={groups()}>
        {(group) => (
          <Dropdown.Group>
            <For each={group}>
              {(item) =>
                match(item)
                  .with('copy-link', () => (
                    <Show when={props.onCopyLink}>
                      {(onCopyLink) => (
                        <Dropdown.CopyItem
                          icon={<LinkIcon class="size-4" />}
                          disabled={props.disabled}
                          onCopy={onCopyLink()}
                        >
                          Copy link
                        </Dropdown.CopyItem>
                      )}
                    </Show>
                  ))
                  .with('edit', () => (
                    <Dropdown.Item
                      disabled={props.disabled}
                      onSelect={props.onEdit}
                    >
                      <PencilIcon class="size-4" />
                      Edit
                    </Dropdown.Item>
                  ))
                  .with('duplicate', () => (
                    <Dropdown.Item
                      disabled={props.disabled}
                      onSelect={props.onDuplicate}
                    >
                      <CopyIcon class="size-4" />
                      Duplicate
                    </Dropdown.Item>
                  ))
                  .with('move-up', () => (
                    <Dropdown.Item
                      disabled={props.disabled}
                      onSelect={props.onMoveUp}
                    >
                      <ArrowUpIcon class="size-4" />
                      {t('viewMenus.moveUp')}
                    </Dropdown.Item>
                  ))
                  .with('move-down', () => (
                    <Dropdown.Item
                      disabled={props.disabled}
                      onSelect={props.onMoveDown}
                    >
                      <ArrowDownIcon class="size-4" />
                      {t('viewMenus.moveDown')}
                    </Dropdown.Item>
                  ))
                  .with('delete', () => (
                    <Dropdown.Item
                      class="text-failure-ink"
                      disabled={props.disabled}
                      onSelect={props.onDelete}
                    >
                      <TrashIcon class="size-4" />
                      Delete view
                    </Dropdown.Item>
                  ))
                  .exhaustive()
              }
            </For>
          </Dropdown.Group>
        )}
      </For>
    </div>
  );
}
