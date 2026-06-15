import { monochromeIcons, setMonochromeIcons, setTooltipsEnabled, tooltipsEnabled } from '@ui/signals/signals';
import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic, randomizeTheme } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';
import { isMobile } from '@core/mobile/isMobile';
import { createSignal, Show } from 'solid-js';
import { TabsInset } from '@core/component/TabsInset';
import IconDice from '@phosphor-icons/core/regular/dice-five.svg?component-solid';
import IconFunnel from '@phosphor-icons/core/regular/funnel-simple.svg?component-solid';
import { setShowDarkThemes, setShowLightThemes, showDarkThemes, showLightThemes } from '@theme/signals/themeSignals';
import { Button, InlineCheckbox, Panel, ToggleSwitch } from '@ui';

type PanelA = 'basic' | 'advanced';
type PanelB ='themes' | 'ui'

function UserInterface() {
  return (
    <div class="grid gap-px bg-edge-muted border-b border-edge-muted">
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

    </div>
  );
}

export function Appearance() {
  const [activeTabA, setActiveTabA] = createSignal<PanelA>('basic');
  const [activeTabB, setActiveTabB] = createSignal<PanelB>('themes');
  const [showFilters, setShowFilters] = createSignal(false);

  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div
        class="max-w-200 size-full"
        style={{
          // Basic editor shrinks to fit its content; Advanced needs a fixed,
          // scrollable height since its per-token list is taller than the panel.
          'grid-template-rows': `${activeTabA() === 'advanced' ? (isMobile() ? '322.5px' : '432.5px') : 'min-content'} 1fr`,
          'grid-template-columns': '1fr',
          'overflow': 'hidden',
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
            <Show when={!isMobile()}>
              <ThemeTools class="flex-1 min-w-0" />
            </Show>
          </Panel.Header>

          <Show when={isMobile()}>
            <Panel.Toolbar>
              <ThemeTools class="flex-1 min-w-0" />
            </Panel.Toolbar>
          </Show>

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
                class="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
                onClick={() => setShowLightThemes((v) => !v)}
              >
                <InlineCheckbox checked={showLightThemes()} />
                Light
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
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
