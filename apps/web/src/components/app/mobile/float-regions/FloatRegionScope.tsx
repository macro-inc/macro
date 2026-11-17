import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createContext,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';
import { FloatRegions } from './float-region-state';

const FloatRegionAnchorContext = createContext<{
  anchor: Accessor<HTMLElement | undefined>;
  isActive: Accessor<boolean>;
}>();

/** Keep portaled page chrome inside the content pane that owns it. */
export function FloatRegionScope(
  props: ParentProps<{
    anchor: Accessor<HTMLElement | undefined>;
    active?: Accessor<boolean>;
  }>
) {
  const panel = useSplitPanel();
  const size = createElementSize(props.anchor);
  const isActive = () => {
    const element = props.anchor();
    return (
      isTouchDevice() &&
      (props.active?.() ?? true) &&
      (panel?.isPanelActive() ?? true) &&
      !!size.width &&
      !!size.height &&
      !!element?.isConnected
    );
  };
  if (panel) {
    onCleanup(
      FloatRegions.registerScope({
        pane: panel.handle.id,
        anchor: props.anchor,
        isActive,
      })
    );
  }
  return (
    <FloatRegionAnchorContext.Provider
      value={{ anchor: props.anchor, isActive }}
    >
      {props.children}
    </FloatRegionAnchorContext.Provider>
  );
}

export function useFloatRegionAnchor() {
  return useContext(FloatRegionAnchorContext);
}
