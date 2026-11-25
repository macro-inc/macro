import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { followContentInsetBottom } from '@core/mobile/viewport-insets';
import { Layer } from '@ui';
import { CanvasInspectorSections } from '../shared/canvas-inspector-parts';

/**
 * A phone's inspector: a sheet over the lower half of the screen. Its scrim
 * is clear, so a change of fill or stroke shows on the canvas above as it is
 * made, and still takes the tap that closes the sheet, which leaves the
 * selection as it was.
 */
export function MobileCanvasInspectorSheet(props: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <MobileDrawer
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="bg-transparent backdrop-filter-none" />
        <MobileDrawer.Content aria-label="Canvas inspector" maxHeight={50}>
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody data-canvas-inspector-scroll>
            <CanvasInspectorSections swatchRows />
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/** What the side panel takes of the canvas's right edge: its width and gutter. */
export const INSPECTOR_PANEL_CLEARANCE = '17rem';

/**
 * A tablet's inspector (and a phone's, turned sideways): the floating panel
 * on the right, between the split header and the bottom chrome.
 */
export function MobileCanvasInspectorPanel() {
  return (
    <Layer depth={2}>
      <aside
        ref={followContentInsetBottom}
        class="absolute right-4 z-30 flex w-64 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-lg"
        style={{
          top: 'calc(var(--mobile-content-inset-top, 0px) + 0.5rem)',
          'max-height':
            'calc(100% - var(--mobile-content-inset-top, 0px) - var(--mobile-content-inset-bottom, 0px) - 1rem)',
        }}
        aria-label="Canvas inspector"
      >
        <div
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4"
          data-canvas-inspector-scroll
        >
          <CanvasInspectorSections />
        </div>
      </aside>
    </Layer>
  );
}
