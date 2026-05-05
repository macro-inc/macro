import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';

import { Panel } from '@ui';
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
        <Panel depth={2}>
          <div class="flex flex-col h-full overflow-hidden">
            <div class="relative flex items-center gap-3 h-10 shrink-0 px-[20px] after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-edge-muted after:content-['']">
              <div class="h-full shrink-0">
                <Tabs
                  list={tabList}
                  value={activeTab()}
                  defaultValue="basic"
                  onChange={(value) => setActiveTab(value as EditorTab)}
                />
              </div>
              <Show when={!isMobile()}>
                <div class="flex-1 min-w-0 h-full">
                  <ThemeTools />
                </div>
              </Show>
            </div>

            <Show when={isMobile()}>
              <div class="flex items-center px-[20px] py-1.5 border-b border-edge-muted shrink-0 min-w-0 overflow-hidden">
                <ThemeTools />
              </div>
            </Show>

            <div class="flex-1 overflow-auto min-h-0">
              <Show when={activeTab() === 'basic'}>
                <ThemeEditorBasic />
              </Show>
              <Show when={activeTab() === 'advanced'}>
                <ThemeEditorAdvanced />
              </Show>
            </div>
          </div>
        </Panel>

        <div class="grid grid-cols-1 gap-2 overflow-hidden min-h-0">
          <Panel depth={2}>
            <ThemeList />
          </Panel>
        </div>
      </div>
    </div>
  );
}
