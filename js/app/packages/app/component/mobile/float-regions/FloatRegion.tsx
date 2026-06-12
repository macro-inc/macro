import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { isMobile } from '@core/mobile/isMobile';
import { onCleanup, type ParentProps, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { type FloatRegionName, FloatRegions } from './float-region-state';

export type FloatRegionProps = ParentProps<{
  region: FloatRegionName;
  /** Higher wins; ties go to the most recently mounted contributor. Default 0. */
  priority?: number;
  /** Extra reactive gate, e.g. `() => !virtualKeyboardVisible()`. */
  active?: () => boolean;
}>;

/**
 * Contributes children to a floating bottom-chrome region (see
 * FloatRegionHost). Children render through a Portal, so they keep this
 * component's owner context (providers, signals, etc.).
 *
 * Inside a SplitPanel, contributions from inactive (background swipe) panels
 * are ignored automatically. Among active contributors to the same region the
 * highest priority wins; ties go to the most recently mounted.
 *
 * Contributions own their horizontal padding (`px-(--mobile-chrome-gutter)`
 * to align with the dock) and must re-enable `pointer-events-auto` on
 * interactive content — the host is pointer-transparent.
 */
export function FloatRegion(props: FloatRegionProps) {
  const panel = useSplitPanel();

  const registration = FloatRegions.register({
    region: props.region,
    priority: props.priority ?? 0,
    isActive: () =>
      isMobile() &&
      (panel?.isPanelActive() ?? true) &&
      (props.active?.() ?? true),
  });
  onCleanup(registration.unregister);

  return (
    <Show when={registration.isWinner() && FloatRegions.mount(props.region)}>
      {(mountEl) => <Portal mount={mountEl()}>{props.children}</Portal>}
    </Show>
  );
}

/**
 * Renders children in normal flow on desktop and floats them into `region`
 * on mobile. Note: crossing the mobile breakpoint remounts children (e.g.
 * editors lose selection; drafts must persist on their own).
 */
export function FloatRegionOrInline(props: FloatRegionProps) {
  return (
    <Show when={isMobile()} fallback={props.children}>
      <FloatRegion {...props} />
    </Show>
  );
}
