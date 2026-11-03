import { t } from '@app/lib/i18n';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CopyIcon from '@phosphor/copy.svg';
import LinkIcon from '@phosphor/link.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

export function SavedViewMenuItems(props: {
  owned: boolean;
  disabled?: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  /** Present only in lists the viewer can reorder; absent at either end. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div class="flex w-full flex-col divide-y divide-edge-divider">
      <Dropdown.Group>
        <Show when={props.owned}>
          <Dropdown.Item disabled={props.disabled} onSelect={props.onEdit}>
            <PencilIcon class="size-4" />
            Edit
          </Dropdown.Item>
        </Show>
        <Dropdown.Item disabled={props.disabled} onSelect={props.onDuplicate}>
          <CopyIcon class="size-4" />
          Duplicate
        </Dropdown.Item>
        <Dropdown.Item onSelect={props.onCopyLink}>
          <LinkIcon class="size-4" />
          Copy link
        </Dropdown.Item>
      </Dropdown.Group>
      <Show when={props.onMoveUp || props.onMoveDown}>
        <Dropdown.Group>
          <Show when={props.onMoveUp}>
            {(onMoveUp) => (
              <Dropdown.Item disabled={props.disabled} onSelect={onMoveUp()}>
                <ArrowUpIcon class="size-4" />
                {t('viewMenus.moveUp')}
              </Dropdown.Item>
            )}
          </Show>
          <Show when={props.onMoveDown}>
            {(onMoveDown) => (
              <Dropdown.Item disabled={props.disabled} onSelect={onMoveDown()}>
                <ArrowDownIcon class="size-4" />
                {t('viewMenus.moveDown')}
              </Dropdown.Item>
            )}
          </Show>
        </Dropdown.Group>
      </Show>
      <Show when={props.owned}>
        <Dropdown.Group>
          <Dropdown.Item
            class="text-failure-ink"
            disabled={props.disabled}
            onSelect={props.onDelete}
          >
            <TrashIcon class="size-4" />
            Delete view
          </Dropdown.Item>
        </Dropdown.Group>
      </Show>
    </div>
  );
}
