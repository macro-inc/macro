import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';
import { isMobile } from '@core/mobile/isMobile';
import { createSignal, Show } from 'solid-js';
import { Tabs } from '@core/component/Tabs';
import { Panel } from '@ui';
import { UI } from './UI';

type PanelA = 'basic' | 'advanced';
type PanelB ='themes' | 'ui'

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
            <Tabs
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
            <Tabs
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
              <UI />
            </Show>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
