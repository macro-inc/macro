import { isInBlock } from '@core/block';
import { blockElementSignal } from '@core/signal/blockElement';
import Copy from '@icon/system/regular/copy.svg';
import DotsThree from '@icon/system/regular/list.svg';
import TextT from '@icon/system/regular/text-t.svg';
import TrashSimple from '@icon/system/regular/trash-simple.svg';
import { Dropdown } from '@ui';
import { createSignal } from 'solid-js';

/** Copy / Convert to text / Delete, behind a `⋯` trigger. */
export function PasteActionsMenu(props: {
  onCopy: () => void;
  onConvertToText: () => void;
  onDelete: () => void;
  class?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const portalMount = isInBlock() ? blockElementSignal.get : () => undefined;

  return (
    <div class={props.class} on:click={(e) => e.stopPropagation()}>
      <Dropdown open={open()} onOpenChange={setOpen}>
        <Dropdown.Trigger size="icon-sm" variant="ghost">
          <DotsThree />
        </Dropdown.Trigger>
        <Dropdown.Content mount={portalMount()}>
          <Dropdown.Group>
            <Dropdown.Item onSelect={props.onCopy}>
              <Copy class="size-4 shrink-0" />
              <span class="flex-1 truncate">Copy</span>
            </Dropdown.Item>
            <Dropdown.Item onSelect={props.onConvertToText}>
              <TextT class="size-4 shrink-0" />
              <span class="flex-1 truncate">Convert to text</span>
            </Dropdown.Item>
          </Dropdown.Group>
          <Dropdown.Group>
            <Dropdown.Item onSelect={props.onDelete}>
              <TrashSimple class="size-4 shrink-0" />
              <span class="flex-1 truncate">Delete</span>
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
