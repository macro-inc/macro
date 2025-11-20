import { lastExecutedCommand } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { createMemo } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

export function useNavigatedFromJK() {
  const {
    unifiedListContext: {
      entitiesSignal: [_entities],
    },
  } = useSplitPanelOrThrow();
  const navigatedFromJK = createMemo(() => {
    const entities = _entities();
    if (!entities) return false;
    return (
      entities.length > 0 &&
      document.documentElement.getAttribute('data-modality') === 'keyboard' &&
      (lastExecutedCommand()?.hotkeyToken !== TOKENS.entity.step.end ||
        lastExecutedCommand()?.hotkeyToken !== TOKENS.entity.select.end)
    );
  });
  return { navigatedFromJK };
}
