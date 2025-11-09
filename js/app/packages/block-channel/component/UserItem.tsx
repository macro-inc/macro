import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import DotsThree from '@icon/bold/dots-three-bold.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { createSignal, Show } from 'solid-js';

export type UserItemProps = {
  id: string;
  description: string;
  currentUserId?: string;
  mountPoint?: HTMLDivElement;
  removeParticipant?: () => void;
  editable?: boolean;
};

export function UserItem(props: UserItemProps) {
  const [open, setOpen] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);

  const hoveredState = () => {
    return hovered() || open();
  };

  return (
    <div
      class={`flex group flex-row items-center justify-between overflow-x-hidden w-full hover:bg-hover transition-none hover:transition ${hoveredState() ? 'bg-hover' : ''} p-2 rounded-sm`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div class="flex flex-row gap-2 items-center w-full">
        <UserIcon id={props.id} size="md" isDeleted={false} />
        <div class="flex flex-col gap-0 w-full">
          <TruncatedText>
            <p class="text-sm">{idToEmail(props.id)}</p>
          </TruncatedText>
          <p class="text-xs text-ink-muted">{props.description}</p>
        </div>
      </div>
      <Show
        when={props.currentUserId !== props.id && props.editable}
        fallback={<div />}
      >
        <DropdownMenu onOpenChange={setOpen}>
          <DropdownMenu.Trigger
            class={`${!hoveredState() ? 'hidden' : 'ring-edge shadow shadow-edge/10 scale-105 bg-menu ring-1 text-ink flex'} 
            group-hover:flex flex-none h-7 w-7 p-1 mr-1 
            rounded-full justify-center items-center text-ink 
            hover:text-ink group-hover:bg-hover group-hover:ring-1 
            group-hover:ring-edge/10 group-hover:shadow shadow-edge/10 
            hover:scale-105 transition-scale duration-200 hover:bg-menu`}
          >
            <DotsThree />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal mount={props.mountPoint}>
            <DropdownMenuContent>
              <MenuItem text="Remove" onClick={props.removeParticipant} />
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>
    </div>
  );
}
