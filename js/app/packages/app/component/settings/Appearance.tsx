import { ThemeEditorBasic } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';

import { Panel } from '@ui';

export function Appearance() {
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
          <ThemeTools />
          <ThemeEditorBasic />
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
