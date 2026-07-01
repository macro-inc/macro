import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useHistory } from './HistoryContext';

export function OldOverlay() {
  const history = useHistory();
  const splitPanel = useSplitPanel();
  const oldOverlayMount = () => splitPanel?.layoutRefs.overlay;

  return (
    <Show when={history.isOpen() && oldOverlayMount()}>
      <Portal mount={oldOverlayMount()!}>
        <div
          class="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ 'z-index': 25 }}
        >
          <div
            class="absolute inset-0 rounded-xl"
            style={{
              'box-shadow':
                'inset 0 0 3rem 2.75rem oklch(calc(var(--b0l) * 0.9) var(--b0c) var(--b0h) / 0.96)',
            }}
          />
          <div
            class="absolute inset-3 rounded-xl"
            style={{
              'box-shadow':
                'inset 0 0 6rem 1.5rem oklch(calc(var(--b0l) * 0.9) var(--b0c) var(--b0h) / 0.58)',
            }}
          />
          <div
            class="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 48%, oklch(calc(var(--b0l) * 0.9) var(--b0c) var(--b0h) / 0.14) 68%, oklch(calc(var(--b0l) * 0.9) var(--b0c) var(--b0h) / 0.58) 86%, oklch(calc(var(--b0l) * 0.9) var(--b0c) var(--b0h) / 0.96) 100%)',
            }}
          />
        </div>
      </Portal>
    </Show>
  );
}
