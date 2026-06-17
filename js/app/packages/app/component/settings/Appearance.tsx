import { monochromeIcons, setMonochromeIcons, setTooltipsEnabled, tooltipsEnabled } from '@ui/signals/signals';
import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic, randomizeTheme } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';
import { isMobile } from '@core/mobile/isMobile';
import { createSignal, For, Show } from 'solid-js';
import { TabsInset } from '@core/component/TabsInset';
import IconDice from '@phosphor-icons/core/regular/dice-five.svg?component-solid';
import IconFunnel from '@phosphor-icons/core/regular/funnel-simple.svg?component-solid';
import { darkModeTheme, lightModeTheme, setDarkModeTheme, setLightModeTheme, setShowDarkThemes, setShowLightThemes, setThemeShouldMatchSystem, showDarkThemes, showLightThemes, themes, themeShouldMatchSystem } from '@theme/signals/themeSignals';
import { isTokensDark } from '@theme/utils/themeUtils';
import { ThemeChips } from '@theme/components/ThemeChips';
import { ThemeChipPill } from '@theme/components/ThemeChipPill';
import type { ThemeV2 } from '@theme/types/themeTypes';
import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import { Button, cn, Dropdown, InlineCheckbox, Panel, ToggleSwitch } from '@ui';

type PanelA = 'basic' | 'advanced';
type PanelB ='themes' | 'ui'

function ThemePreferenceRow(props: {
  label: string;
  value: () => string;
  options: () => ThemeV2[];
  onSelect: (id: string) => void;
  // Default themes only take effect while auto-detect is on, so the control is
  // dimmed and non-interactive otherwise.
  disabled?: () => boolean;
}) {
  const selectedTheme = () =>
    themes().find((theme) => theme.id === props.value());

  return (
    <div
      class={cn(
        // Nested under the auto-detect toggle: the indent marks these as
        // sub-settings that only apply while auto-detect is on. Shorter than the
        // top-level rows so they cluster tightly beneath the toggle.
        'bg-surface flex items-center justify-between h-11 px-6 pl-10 transition-opacity',
        props.disabled?.() && 'opacity-50 pointer-events-none'
      )}
      aria-disabled={props.disabled?.()}
    >
      <div class="text-sm">{props.label}</div>
      <Dropdown>
        {/* Same pill as the theme mention chip; `as` makes it the dropdown trigger. */}
        <KobalteDropdownMenu.Trigger
          as={ThemeChipPill}
          class="h-auto"
          disabled={props.disabled?.()}
          theme={selectedTheme()}
          name={selectedTheme()?.name ?? props.value()}
        />
        <Dropdown.Content>
          <Dropdown.Group>
            <For each={props.options()}>
              {(theme) => (
                <Dropdown.Item
                  class="touch:min-h-10"
                  onSelect={() => props.onSelect(theme.id)}
                >
                  <span class="flex items-center gap-2">
                    <ThemeChips theme={theme} size="sm" />
                    {theme.name}
                  </span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}

function UserInterface() {
  const lightThemes = () =>
    themes().filter((theme) => !isTokensDark(theme.tokens));
  const darkThemes = () => themes().filter((theme) => isTokensDark(theme.tokens));

  return (
    <div class="flex flex-col">
      <div class="bg-surface flex items-center justify-between h-15.25 px-6">
        <div class="text-sm">Monochrome Icons</div>
        <ToggleSwitch
          onChange={setMonochromeIcons}
          checked={monochromeIcons()}
        />
      </div>

      <div class="bg-surface flex items-center justify-between h-15.25 px-6">
        <div class="text-sm">Show Tooltips</div>
        <ToggleSwitch
          onChange={setTooltipsEnabled}
          checked={tooltipsEnabled()}
        />
      </div>

      <div class="bg-surface flex items-center justify-between h-15.25 px-6">
        <div class="flex flex-col gap-0.5">
          <div class="text-sm">Auto-detect color scheme</div>
          <div class="text-xs text-ink-muted">
            Switch theme with your system's light/dark mode
          </div>
        </div>
        <ToggleSwitch
          onChange={setThemeShouldMatchSystem}
          checked={themeShouldMatchSystem()}
        />
      </div>

      <ThemePreferenceRow
        label="Default light theme"
        value={lightModeTheme}
        options={lightThemes}
        onSelect={setLightModeTheme}
        disabled={() => !themeShouldMatchSystem()}
      />

      <ThemePreferenceRow
        label="Default dark theme"
        value={darkModeTheme}
        options={darkThemes}
        onSelect={setDarkModeTheme}
        disabled={() => !themeShouldMatchSystem()}
      />

    </div>
  );
}

export function Appearance() {
  const [activeTabA, setActiveTabA] = createSignal<PanelA>('basic');
  const [activeTabB, setActiveTabB] = createSignal<PanelB>('themes');
  const [showFilters, setShowFilters] = createSignal(false);

  // The top panel sizes to the active editor; Advanced needs a fixed, scrollable
  // height since its per-token list is taller than the panel.
  const rowA = () =>
    activeTabA() === 'advanced'
      ? isMobile()
        ? '322.5px'
        : '432.5px'
      : 'min-content';
  // On mobile the whole panel scrolls as one column, so the bottom panel sizes to
  // its content rather than filling (and being clipped by) a fixed viewport row.
  const rowB = () => (isMobile() ? 'min-content' : '1fr');

  return (
    <div
      class={cn(
        'h-full flex justify-center p-2',
        // Mobile: scroll the whole settings column. Desktop: fixed two-pane layout.
        isMobile() ? 'overflow-y-auto items-start' : 'overflow-hidden'
      )}
    >
      <div
        class={cn('max-w-200 w-full', !isMobile() && 'h-full')}
        style={{
          // Basic editor shrinks to fit its content; Advanced needs a fixed,
          // scrollable height since its per-token list is taller than the panel.
          'grid-template-rows': `${rowA()} ${rowB()}`,
          'grid-template-columns': '1fr',
          'overflow': isMobile() ? 'visible' : 'hidden',
          'display': 'grid',
          'gap': '8px',
        }}
      >
        <Panel depth={2}>
          <Panel.Header>
            <TabsInset
              onChange={(value) => setActiveTabA(value as PanelA)}
              list={[
                { value: 'basic', label: 'Basic' },
                { value: 'advanced', label: 'Advanced' },
              ]}
              value={activeTabA()}
              defaultValue="basic"
            />
            <ThemeTools class="flex-1 min-w-0" />
          </Panel.Header>

          <Panel.Body scroll={activeTabA() === 'advanced'}>
            <Show when={activeTabA() === 'basic'}>
              <ThemeEditorBasic />
            </Show>
            <Show when={activeTabA() === 'advanced'}>
              <ThemeEditorAdvanced />
            </Show>
          </Panel.Body>
        </Panel>

        <Panel depth={2}>
          <Panel.Header>
            <TabsInset
              onChange={(value) => setActiveTabB(value as PanelB)}
              list={[
                { value: 'themes', label: 'Themes' },
                { value: 'ui', label: 'UI' },
              ]}
              value={activeTabB()}
              defaultValue="list"
            />
            <div class="flex-1" />
            <Show when={activeTabB() === 'themes'}>
              <Button
                label="Filter Themes"
                onPointerDown={() => setShowFilters((v) => !v)}
                variant={showFilters() ? 'cta' : 'ghost'}
                size="icon-sm"
              >
                <IconFunnel />
              </Button>
            </Show>
            <Button
              label="Randomize Theme"
              onPointerDown={randomizeTheme}
              variant="ghost"
              size="icon-sm"
              class="ml-1.5"
            >
              <IconDice />
            </Button>
          </Panel.Header>
          <Show when={activeTabB() === 'themes' && showFilters()}>
            <Panel.Toolbar class="gap-4 pl-5">
              <span class="text-xs text-ink-extra-muted">Filter themes</span>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink touch:min-h-9 touch:pr-2"
                onClick={() => setShowLightThemes((v) => !v)}
              >
                <InlineCheckbox checked={showLightThemes()} />
                Light
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink touch:min-h-9 touch:pr-2"
                onClick={() => setShowDarkThemes((v) => !v)}
              >
                <InlineCheckbox checked={showDarkThemes()} />
                Dark
              </button>
            </Panel.Toolbar>
          </Show>
          <Panel.Body scroll>
            <Show when={activeTabB() === 'themes'}>
              <ThemeList />
            </Show>
            <Show when={activeTabB() === 'ui'}>
              <UserInterface />
            </Show>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
