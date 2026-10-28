import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { cn } from '@ui';
import {
  type Component,
  type ComponentProps,
  Show,
  splitProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type MobileDockIcon = Component<{ class?: string }>;

type MobileDockButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  icon: MobileDockIcon;
  /** Accessible name for the icon-only button. */
  ariaLabel: string;
  active?: boolean;
  unread?: boolean;
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
    'class',
    'iconClass',
  ]);

  return (
    <button
      type="button"
      aria-label={local.ariaLabel}
      aria-description={local.unread ? 'Unread items' : undefined}
      data-unread={local.unread ? '' : undefined}
      class={cn(
        'relative flex size-(--mobile-chrome-button-size) shrink-0 items-center justify-center rounded-full',
        local.active && 'text-accent',
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
          <span
            aria-hidden="true"
            class="pointer-events-none absolute -right-1 -top-1 rounded-full ring-2 ring-chrome"
          >
            <UnreadIndicator active class="size-1.5" />
          </span>
        </Show>
      </div>
    </button>
  );
}
