import { lastExecutedCommand } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { createMemo } from 'solid-js';
import { useSoup } from '@app/component/next-soup/soup-context';

export function useNavigatedFromJK() {
  const soup = useSoup();
  const navigatedFromJK = createMemo(() => {
    const rows = soup.rows();
    if (!rows) return false;
    return (
      rows.length > 0 &&
      document.documentElement.getAttribute('data-modality') === 'keyboard' &&
      (lastExecutedCommand()?.hotkeyToken === TOKENS.entity.step.end ||
        lastExecutedCommand()?.hotkeyToken === TOKENS.entity.select.end)
    );
  });
  return { navigatedFromJK };
}
