import type { ThemeV3 } from '@theme/types/themeTypes';
import { themeCssVars } from '@theme/utils/themeColorTokens';
import { createUniqueId, For, Show } from 'solid-js';

type AppearanceMode = 'system' | 'light' | 'dark';

/** A small, token-accurate preview of Macro, rather than a generic color chip. */
function ThemePreview(props: { theme: ThemeV3 }) {
  return (
    <div
      class="absolute inset-0 overflow-hidden rounded-lg bg-page p-2.5"
      style={{
        ...themeCssVars(props.theme),
        '--color-panel': props.theme.colorTokens.panel,
      }}
    >
      <div class="flex h-full overflow-hidden rounded-md border border-edge-muted bg-panel shadow-sm">
        <div class="flex w-[28%] flex-col gap-1.5 border-r border-edge-muted bg-page p-1.5">
          <div class="mb-1 flex gap-0.5">
            <For each={[0, 1, 2]}>
              {() => <span class="size-1 rounded-full bg-ink/20" />}
            </For>
          </div>
          <div class="h-1.5 rounded-sm bg-accent/25" />
          <div class="h-1 w-4/5 rounded-sm bg-ink/15" />
          <div class="h-1 w-3/5 rounded-sm bg-ink/15" />
        </div>
        <div class="flex flex-1 flex-col gap-1.5 p-2">
          <div class="h-1.5 w-2/3 rounded-sm bg-ink/60" />
          <div class="h-1 w-full rounded-sm bg-ink/15" />
          <div class="h-1 w-4/5 rounded-sm bg-ink/15" />
          <div class="mt-auto flex h-6 items-end justify-end rounded border border-edge-muted bg-panel p-1 shadow-sm">
            <span class="size-2.5 rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearanceModePicker(props: {
  value: AppearanceMode;
  onChange: (mode: AppearanceMode) => void;
  lightTheme: ThemeV3;
  darkTheme: ThemeV3;
}) {
  const name = createUniqueId();
  const modes = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ] as const;
  return (
    <fieldset class="min-w-0" aria-label="Appearance mode">
      <div class="grid grid-cols-3 gap-3">
        <For each={modes}>
          {(mode) => (
            <label class="group flex min-w-0 flex-col items-center gap-2">
              <input
                type="radio"
                name={name}
                value={mode.value}
                checked={props.value === mode.value}
                onChange={() => props.onChange(mode.value)}
                class="peer sr-only"
              />
              <span
                aria-hidden="true"
                class="relative block h-24 w-full rounded-xl border border-ink/10 p-1 transition-colors group-hover:border-ink/25 peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent/30 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
              >
                <span class="absolute inset-1 overflow-hidden rounded-lg">
                  <ThemePreview
                    theme={
                      mode.value === 'dark' ? props.darkTheme : props.lightTheme
                    }
                  />
                  <Show when={mode.value === 'system'}>
                    <span class="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
                      <ThemePreview theme={props.darkTheme} />
                    </span>
                  </Show>
                </span>
              </span>
              <span class="text-sm text-ink-muted peer-checked:font-medium peer-checked:text-ink">
                {mode.label}
              </span>
            </label>
          )}
        </For>
      </div>
    </fieldset>
  );
}
