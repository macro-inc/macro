import { Hotkey } from '@ui';
import { useHistory } from './HistoryContext';
import { Show } from 'solid-js';

export function OldOverlay() {
  const history = useHistory();

  return (
    <Show when={history?.isOpen()}>
      <div class="flex w-full items-center gap-2 bg-alert-bg px-3 py-2 text-xs text-alert-ink">
        <span>You are viewing history.</span>
        <span class="flex items-center gap-1">
          Press <Hotkey shortcut="escape" theme="current" /> to exit.
        </span>
      </div>
    </Show>
  );
}
