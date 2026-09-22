import IconCheck from '@phosphor/check.svg';
import { debounce } from '@solid-primitives/scheduled';
import { Surface } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { UserIcon } from './UserIcon';
import {
  type UserCardAction,
  type UserCardTarget,
  useUserCardActions,
} from './userCardActions';

type UserTooltipProps = UserCardTarget & {
  onClose?: () => void;
};

/**
 * The user card as a hover surface. `UserCardDrawer` renders the same card
 * from the same actions for touch devices, which never hover.
 */
export function UserTooltip(props: UserTooltipProps) {
  const actions = useUserCardActions(() => props);

  // Determine avatar props based on what we have
  const avatarProps = () => {
    if (props.id) {
      return { id: props.id, photoUrl: props.photoUrl } as const;
    }
    if (props.email) {
      return { email: props.email, photoUrl: props.photoUrl } as const;
    }
    // Fallback - use email even if empty to satisfy the union type
    return { email: '?', photoUrl: props.photoUrl } as const;
  };

  return (
    <Surface depth={2} class="rounded-xl shadow-lg shadow-drop-shadow">
      <div class="text-ink max-w-lg">
        <div class="flex items-center gap-2 p-2">
          <UserIcon
            {...avatarProps()}
            size="lg"
            isDeleted={props.isDeleted}
            showTooltip={false}
            suppressClick
            class="pointer-events-none"
          />

          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{props.displayName}</div>
            <Show when={props.email && props.email !== props.displayName}>
              <div class="text-xs opacity-60 truncate">{props.email}</div>
            </Show>
          </div>
        </div>

        <Show when={actions().length > 0}>
          <div class="border-t border-edge"></div>
          <div class="p-1.5 flex flex-col gap-0.5">
            <For each={actions()}>
              {(action) => (
                <ActionItem action={action} onClose={props.onClose} />
              )}
            </For>
          </div>
        </Show>
      </div>
    </Surface>
  );
}

function ActionItem(props: { action: UserCardAction; onClose?: () => void }) {
  const [copied, setCopied] = createSignal(false);
  const resetCopied = debounce(() => setCopied(false), 800);

  const handleClick = async (event: MouseEvent) => {
    try {
      await props.action.onSelect(event);
    } catch {
      // The action reports the failure; leave the card ready to retry.
      return;
    }
    // A copy keeps the card open long enough to show that it landed; anything
    // that navigates has already taken the user elsewhere.
    if (props.action.copies) {
      setCopied(true);
      resetCopied();
      return;
    }
    props.onClose?.();
  };

  return (
    <button
      type="button"
      class="group rounded-lg w-full flex items-center gap-2 px-2 h-8 text-left font-medium text-xs cursor-default outline-none hover:bg-ink/5 focus:bg-ink/5 data-highlighted:bg-ink/5 data-disabled:opacity-50 data-disabled:cursor-not-allowed"
      onClick={handleClick}
    >
      <Show when={!copied()} fallback={<IconCheck class="size-3.5" />}>
        <Dynamic component={props.action.icon} class="size-3.5" />
      </Show>
      {props.action.label}
    </button>
  );
}
