import { useSettingsState } from '@core/constant/SettingsState';
import { hapticImpact } from '@core/mobile/haptics';
import IconGear from '@icon/macro-gear.svg';
import { cn, Layer } from '@ui';
import type { Accessor } from 'solid-js';
import { Show } from 'solid-js';
import { useSplitLayout } from '../../split-layout/layout';
import {
  MOBILE_FLOATING_BUTTON_OFFSCREEN_RIGHT,
  MOBILE_FLOATING_BUTTON_TRANSITION,
  MOBILE_FLOATING_BUTTON_VISIBLE,
} from './soup-view-mobile-floating-motion';

export function SoupViewMobileSettingsButton(props: {
  visible: Accessor<boolean>;
}) {
  const { settingsOpen, toggleSettings } = useSettingsState();
  const { getSplitCount } = useSplitLayout();

  const isSingleSplit = () => getSplitCount() <= 1;

  return (
    <Show when={isSingleSplit()}>
      <Layer depth={4}>
        <button
          type="button"
          class={cn(
            'absolute bottom-[4.5rem] right-4 z-10 size-11 rounded-full',
            'bg-surface text-ink flex items-center justify-center shadow-md',
            MOBILE_FLOATING_BUTTON_TRANSITION,
            'ring ring-edge hover:text-accent hover:bg-hover',
            settingsOpen() && 'bg-accent/20 text-accent ring-accent/20',
            props.visible()
              ? MOBILE_FLOATING_BUTTON_VISIBLE
              : MOBILE_FLOATING_BUTTON_OFFSCREEN_RIGHT
          )}
          aria-label={settingsOpen() ? 'Close Settings' : 'Open Settings'}
          aria-hidden={!props.visible()}
          onClick={() => {
            hapticImpact('light');
            toggleSettings();
          }}
        >
          <IconGear class="size-5" />
        </button>
      </Layer>
    </Show>
  );
}
