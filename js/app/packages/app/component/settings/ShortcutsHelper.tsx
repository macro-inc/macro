import { useSettingsState } from '@core/constant/SettingsState';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import KeyboardIcon from '@icon/regular/keyboard.svg';
import CloseIcon from '@icon/regular/x.svg';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal, Show } from 'solid-js';

const [showShortcutsHelper, setShowShortcutsHelper] = makePersisted(
  createSignal(true),
  { name: 'show-shortcuts-helper' }
);

export function ShortcutsHelper() {
  const { openSettings } = useSettingsState();

  const handleClick = () => {
    openSettings('Shortcuts');
  };

  const handleDismiss = (e: MouseEvent) => {
    e.stopPropagation();
    setShowShortcutsHelper(false);
  };

  const shouldShow = () =>
    showShortcutsHelper() && !isTouchDevice();

  return (
    <Show when={shouldShow()}>
      <div class="fixed bottom-4 right-4 z-50 group">
        <button
          type="button"
          onClick={handleClick}
          class="flex items-center gap-1.5 rounded-xs px-3 py-1.5 bg-panel border border-edge-muted ring-accent text-ink text-sm font-medium shadow hover:bg-panel-secondary hover:border-accent/50 transition-colors"
        >
          <KeyboardIcon class="size-4 text-accent" />
          <span>Shortcuts</span>
        </button>

        {/* Dismiss button */}
        <button
          type="button"
          onClick={handleDismiss}
          class="absolute -top-1.5 -right-1.5 flex items-center justify-center size-4 bg-edge rounded-full text-ink-muted hover:text-ink transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Dismiss shortcuts helper"
        >
          <CloseIcon class="size-2.5" />
        </button>
      </div>
    </Show>
  );
}

