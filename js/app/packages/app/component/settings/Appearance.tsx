import { monochromeIcons, setMonochromeIcons, setTooltipsEnabled, tooltipsEnabled } from '@ui/signals/signals';
import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';
import { isMobile } from '@core/mobile/isMobile';
import { createSignal, Show } from 'solid-js';
import { TabsInset } from '@core/component/TabsInset';
import { Panel, ToggleSwitch } from '@ui';

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

  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div
        class="max-w-200 size-full"
        style={{
          'grid-template-rows': `${isMobile() ? '322.5px' : '432.5px'} 1fr`,
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

          <Panel.Body scroll>
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
          </Panel.Header>
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
