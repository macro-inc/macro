import { t } from '@app/lib/i18n';
import BellIcon from '@icon/system/regular/bell.svg';
import ClockCounterClockwiseIcon from '@icon/system/regular/clock-counter-clockwise.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Tabs } from '@ui';
import { createSignal } from 'solid-js';
import type { NewHomeTab } from '../core/new-home-mode';

/** Below this list width the tabs keep only their icons. */
const ICON_ONLY_WIDTH_PX = 280;

/**
 * Recent and Notifications, as the pills of the Notifications view's All and
 * Unread. A narrow list shows only their icons, named in tooltips.
 */
export function NewHomeTabs(props: {
  value: NewHomeTab;
  onChange: (tab: NewHomeTab) => void;
  /** Unread notifications: the Notifications tab's dot. */
  unread: boolean;
}) {
  const [frame, setFrame] = createSignal<HTMLDivElement>();
  const size = createElementSize(frame);
  const iconOnly = () =>
    size.width !== null && size.width > 0 && size.width < ICON_ONLY_WIDTH_PX;
  // One object per tab for the view's life: the tabs keep their elements,
  // and with them focus and tooltips, as the dot comes and goes.
  const options = [
    // Labels alone while they fit; icons alone once they don't.
    {
      value: 'recent' as const,
      get label() {
        return t('home.recent');
      },
      get icon() {
        return iconOnly() ? ClockCounterClockwiseIcon : undefined;
      },
    },
    {
      value: 'notifications' as const,
      get label() {
        return t('home.notifications');
      },
      get icon() {
        return iconOnly() ? BellIcon : undefined;
      },
      get dot() {
        return props.unread;
      },
    },
  ];
  return (
    // The New Chat button's insets, so the two line up and share a width.
    <div
      ref={setFrame}
      class="shrink-0 px-(--sidebar-gutter) pt-(--sidebar-gutter) pb-1"
    >
      <Tabs
        aria-label={t('home.views')}
        fullWidth
        iconOnly={iconOnly()}
        options={options}
        value={props.value}
        onChange={props.onChange}
      />
    </div>
  );
}
