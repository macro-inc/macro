import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { mergeProps, Show } from 'solid-js';
import {
  UnifiedModelSelectorRoot,
  type UnifiedModelSelectorState,
} from './components/unified-model-selector/root';
import { MobileModelSelector } from './views/mobile/model-selector';
import { DesktopModelSelector } from './views/model-selector/desktop-model-selector';

/** Shared selection state survives a platform view change. */
export function UnifiedModelSelector(props: {
  state: UnifiedModelSelectorState;
}) {
  const state = mergeProps(() => props.state);
  return (
    <UnifiedModelSelectorRoot state={state}>
      <Show when={isTouchDevice()} fallback={<DesktopModelSelector />}>
        <MobileModelSelector />
      </Show>
    </UnifiedModelSelectorRoot>
  );
}
