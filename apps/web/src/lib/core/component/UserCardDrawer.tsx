import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { UserIcon } from './UserIcon';
import {
  type UserCardAction,
  type UserCardTarget,
  useUserCardActions,
} from './userCardActions';

const [target, setTarget] = createSignal<UserCardTarget>();
const [isOpen, setIsOpen] = createSignal(false);

/**
 * Opens the user card for `user` as a bottom sheet. Touch devices never get
 * the hover card, so tapping an avatar or an @mention opens this instead.
 */
export function openUserCard(user: UserCardTarget) {
  setTarget(user);
  setIsOpen(true);
}

/**
 * Host for the tapped-user card. Mounted once per app, near the root, so a
 * mention inside an editor doesn't carry a sheet of its own.
 */
export function UserCardDrawer() {
  const [restoreFocus, setRestoreFocus] = createSignal(true);
  const close = (restoreFocus = true) => {
    setRestoreFocus(restoreFocus);
    setIsOpen(false);
  };

  return (
    <MobileDrawer
      side="bottom"
      open={isOpen()}
      onOpenChange={(open) => !open && close()}
      closeOnOutsidePointerStrategy="pointerdown"
      preventScroll={false}
      preventScrollbarShift={false}
      restoreFocus={restoreFocus()}
      noOutsidePointerEvents={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Profile">
          <MobileDrawer.Handle />
          {/* The target outlives the close so the sheet animates out with its
              contents rather than emptying first. */}
          <Show when={target()}>
            {(user) => (
              <UserCardBody
                user={user()}
                // Navigation owns focus in its destination; copying stays here.
                onAction={(action) => close(action.copies === true)}
              />
            )}
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

function UserCardBody(props: {
  user: UserCardTarget;
  onAction: (action: UserCardAction) => void;
}) {
  const actions = useUserCardActions(() => props.user);

  const avatarProps = () => {
    if (props.user.id) {
      return { id: props.user.id, photoUrl: props.user.photoUrl } as const;
    }
    return {
      email: props.user.email || '?',
      photoUrl: props.user.photoUrl,
    } as const;
  };

  return (
    <>
      <div class="flex items-center gap-3 px-6 pb-4">
        <UserIcon
          {...avatarProps()}
          size="lg"
          isDeleted={props.user.isDeleted}
          showTooltip={false}
          suppressClick
          class="pointer-events-none"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-base font-semibold text-ink">
            {props.user.displayName}
          </div>
          <Show
            when={
              props.user.email && props.user.email !== props.user.displayName
            }
          >
            <div class="truncate text-sm text-ink-muted">
              {props.user.email}
            </div>
          </Show>
        </div>
      </div>

      <Show when={actions().length > 0}>
        <MobileDrawer.ScrollBody>
          <MobileDrawer.Section class="flex flex-col shrink-0">
            <For each={actions()}>
              {(action) => (
                <MobileDrawer.Item
                  data-user-card-action={action.id}
                  onClick={async (event) => {
                    try {
                      await action.onSelect(event);
                    } catch {
                      // The action reports the failure; keep the sheet open.
                      return;
                    }
                    props.onAction(action);
                  }}
                >
                  <span class="flex size-5 shrink-0 items-center justify-center">
                    <Dynamic component={action.icon} class="size-5" />
                  </span>
                  {action.label}
                </MobileDrawer.Item>
              )}
            </For>
          </MobileDrawer.Section>
        </MobileDrawer.ScrollBody>
      </Show>
    </>
  );
}
