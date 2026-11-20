import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { children, onCleanup, type ParentProps, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useFloatRegionAnchor } from './FloatRegionScope';
import { type FloatRegionName, FloatRegions } from './float-region-state';

export type FloatRegionProps = ParentProps<{
  region: FloatRegionName;
  /** Higher wins; ties go to the most recently mounted contributor. Default 0.
   *  Pass an accessor to change priority reactively without remounting. */
  priority?: number | (() => number);
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
  const scope = useFloatRegionAnchor();

  const registration = FloatRegions.register({
    region: props.region,
    anchor: props.region === 'accessory' ? scope?.anchor : undefined,
    pane: props.region === 'accessory' ? panel?.handle?.id : undefined,
    priority: props.priority ?? 0,
    isActive: () =>
      isTouchDevice() &&
      (panel?.isPanelActive() ?? true) &&
      (props.region !== 'accessory' || (scope?.isActive() ?? true)) &&
      (props.active?.() ?? true),
  });
  onCleanup(registration.unregister);

  return (
    <Show when={registration.isWinner() && FloatRegions.mount(props.region)}>
      {(mountEl) => {
        const content = children(() => props.children);
        // An empty contribution still wins, but must not leave a Portal wrapper
        // that prevents the host's empty region from collapsing.
        return (
          <Show when={content.toArray().length > 0}>
            <Portal mount={mountEl()}>{content()}</Portal>
          </Show>
        );
      }}
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
    <Show when={isTouchDevice()} fallback={props.children}>
      <FloatRegion {...props} />
    </Show>
  );
}
