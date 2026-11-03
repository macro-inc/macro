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
