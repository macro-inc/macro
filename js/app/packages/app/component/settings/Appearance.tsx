import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';

import { Window } from '@ui';
import { Tabs } from '@core/component/Tabs';
import { createSignal, Show } from 'solid-js';
import { isMobile } from '@core/mobile/isMobile';

type EditorTab = 'basic' | 'advanced';

export function Appearance() {
  const [activeTab, setActiveTab] = createSignal<EditorTab>('basic');

  const tabList = [
    { value: 'basic', label: 'Basic' },
    { value: 'advanced', label: 'Advanced' },
  ];

  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div
        class="max-w-200 w-full h-full"
        style={{
          'grid-template-rows': 'min-content 1fr',
          'grid-template-columns': '1fr',
          'overflow': 'hidden',
          'display': 'grid',
          'gap': '8px',
        }}
      >
        <Window depth={2}>
          <Window.Header>
            <Tabs
              list={tabList}
              value={activeTab()}
              defaultValue="basic"
              onChange={(value) => setActiveTab(value as EditorTab)}
            />
            <Show when={!isMobile()}>
              <ThemeTools class="flex-1 min-w-0" />
            </Show>
          </Window.Header>

          <Show when={isMobile()}>
            <Window.Toolbar>
              <ThemeTools class="flex-1 min-w-0" />
            </Window.Toolbar>
          </Show>

          <Window.Body scroll>
            <Show when={activeTab() === 'basic'}>
              <ThemeEditorBasic />
            </Show>
            <Show when={activeTab() === 'advanced'}>
              <ThemeEditorAdvanced />
            </Show>
          </Window.Body>
        </Window>

        <Window depth={2}>
                  <ThemeList />
                </Window>
      </div>
    </div>
  );
}
