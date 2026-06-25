import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useHistory } from './HistoryContext';

export function OldOverlay() {
  const history = useHistory();
  const splitPanel = useSplitPanel();
  const oldOverlayMount = () => splitPanel?.layoutRefs.overlay;

  return (
    <Show when={history.isViewingHistory() && oldOverlayMount()}>
      <Portal mount={oldOverlayMount()!}>
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
          <div class="absolute inset-0 rounded-[3rem] shadow-[inset_0_0_3rem_2.75rem_rgba(0,0,0,0.96)]" />
          <div class="absolute inset-3 rounded-[2.5rem] shadow-[inset_0_0_6rem_1.5rem_rgba(0,0,0,0.58)]" />
          <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_48%,rgba(0,0,0,0.14)_68%,rgba(0,0,0,0.58)_86%,rgba(0,0,0,0.96)_100%)]" />
          <div class="absolute bottom-4 right-5 select-none text-sm tracking-wide text-ink/45">
            You are viewing a historical state
          </div>
        </div>
      </Portal>
    </Show>
  );
}
