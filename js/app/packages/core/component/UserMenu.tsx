import { UserIcon } from '@core/component/UserIcon';
import GearIcon from '@icon/regular/gear.svg';
import SignOutIcon from '@icon/regular/sign-out.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Show, type JSX } from 'solid-js';

interface UserMenuProps {
  userId: string;
  onSettings?: () => void;
  onSignOut?: () => void;
  extraItems?: JSX.Element;
  size?: 'sm' | 'md' | 'lg';
}

export function UserMenu(props: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger class="rounded-lg cursor-pointer">
        <UserIcon
          id={props.userId}
          size={props.size ?? 'md'}
          suppressClick
          showTooltip={false}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-action-menu bg-surface border border-edge-muted rounded-lg shadow-lg min-w-40 p-1">
          <Show when={props.onSettings}>
            <DropdownMenu.Item
              onSelect={props.onSettings}
              class="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-ink/5 cursor-pointer"
            >
              <GearIcon class="size-4 text-ink-muted" />
              <span>Settings</span>
            </DropdownMenu.Item>
          </Show>
          {props.extraItems}
          <Show when={props.onSignOut}>
            <Show when={props.onSettings || props.extraItems}>
              <div class="h-px bg-edge-muted my-1" />
            </Show>
            <DropdownMenu.Item
              onSelect={props.onSignOut}
              class="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-ink/5 cursor-pointer text-failure"
            >
              <SignOutIcon class="size-4" />
              <span>Sign out</span>
            </DropdownMenu.Item>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
