import CheckIcon from '@phosphor/check.svg';
import DesktopIcon from '@phosphor/desktop.svg';
import MoonIcon from '@phosphor/moon.svg';
import SunIcon from '@phosphor/sun.svg';
import {
  setThemeMode,
  type ThemeMode,
  themeMode,
} from '@theme/signals/themeSignals';
import { For, Show } from 'solid-js';
import { WorkspacePreview } from '../components/WorkspacePreview';
import { ContinueButton } from './shared';

const MODES = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: DesktopIcon },
] satisfies { value: ThemeMode; label: string; icon: typeof SunIcon }[];

export function CustomizeStep(props: { onContinue: () => void }) {
  return (
    <div class="flex flex-col gap-7">
      <WorkspacePreview />
      <fieldset class="flex flex-col gap-3">
        <legend class="mb-3 text-xs font-medium text-ink-muted">
          Choose your atmosphere
        </legend>
        <div class="grid grid-cols-3 gap-3">
          <For each={MODES}>
            {(mode) => (
              <label class="relative flex items-center justify-center gap-2 rounded-2xl border border-edge bg-surface px-3 py-4 text-xs has-[:checked]:border-ink/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/30">
                <input
                  class="sr-only"
                  type="radio"
                  name="workspace-appearance"
                  value={mode.value}
                  checked={themeMode() === mode.value}
                  onChange={() => setThemeMode(mode.value)}
                />
                <mode.icon class="size-4" />
                {mode.label}
                <Show when={themeMode() === mode.value}>
                  <CheckIcon class="size-3" />
                </Show>
              </label>
            )}
          </For>
        </div>
      </fieldset>
      <p class="text-center text-xs leading-5 text-ink-muted">
        Your space should feel like you.
        <br />
        Explore more themes and profile options in Settings anytime.
      </p>
      <ContinueButton label="This feels like me" onClick={props.onContinue} />
    </div>
  );
}
