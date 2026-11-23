import { unreadLabel } from '@app/features/notifications-inbox/core/inbox-unread';
import { t } from '@app/lib/i18n';
import { UnreadCount } from '@entity/components/UnreadCount';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { cn } from '@ui';
import {
  type Component,
  type ComponentProps,
  Show,
  splitProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { unreadDescription } from '../unread-description';

export type MobileDockIcon = Component<{ class?: string }>;

type MobileDockButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  icon: MobileDockIcon;
  /** Accessible name for the icon-only button. */
  ariaLabel: string;
  /**
   * Pass this only on buttons that can be selected: selection reads as full
   * ink against muted siblings, so an explicitly unselected button dims.
   * Buttons that are always actions (Search) leave it unset and stay at full
   * ink.
   */
  active?: boolean;
  unread?: boolean;
  /** How many unread notifications the view holds, shown in place of the dot. */
  unreadCount?: number;
  iconClass?: string;
};

/**
 * Renders flat: hosts wrap it in a MobileDockIsland (alone or grouped with
 * other controls) to give it the floating chrome.
 */
export function MobileDockButton(props: MobileDockButtonProps) {
  const [local, rest] = splitProps(props, [
    'icon',
    'ariaLabel',
    'active',
    'unread',
    'unreadCount',
    'class',
    'iconClass',
  ]);

  return (
    <button
      type="button"
      aria-label={local.ariaLabel}
      aria-description={
        local.unread
          ? (unreadDescription(local.unreadCount) ?? t('nav.unreadItems'))
          : undefined
      }
      data-unread={local.unread ? '' : undefined}
      data-unread-count={unreadLabel(local.unreadCount)}
      class={cn(
        'relative flex size-(--mobile-chrome-button-size) shrink-0 items-center justify-center rounded-full',
        local.active === false && 'text-ink-extra-muted',
        local.class
      )}
      {...rest}
    >
      <div
        class={cn(
          'relative size-(--mobile-chrome-icon-size) shrink-0 [&_svg]:size-(--mobile-chrome-icon-size)',
          local.iconClass
        )}
      >
        <Dynamic component={local.icon} />
        <Show when={local.unread}>
          <Show
            when={unreadLabel(local.unreadCount)}
            fallback={
              <span
                aria-hidden="true"
                class="pointer-events-none absolute -right-1 -top-1 rounded-full ring-2 ring-chrome"
              >
                <UnreadIndicator active class="size-1.5" />
              </span>
            }
          >
            {(count) => (
              // Anchored by its right edge, so a longer count stays inside
              // the button instead of reaching its neighbour.
              <UnreadCount
                label={count()}
                class="absolute -right-2.5 -top-1.5 ring-chrome"
              />
            )}
          </Show>
        </Show>
      </div>
    </button>
  );
}
