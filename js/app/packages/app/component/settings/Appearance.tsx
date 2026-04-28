import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';

import { Panel } from '@ui';

export function Appearance() {
  return (
    <div
      style={{
        'grid-template-rows': 'min-content 1fr',
        'grid-template-columns': '1fr',
        'overflow': 'hidden',
        'display': 'grid',
        'padding': '20px',
        'height': '100%',
        'gap': '20px',
      }}
    >
      <Panel>
        <ThemeTools />
        <ThemeEditorBasic />
      </Panel>

      <div class="@container grid grid-cols-1 @[700px]:grid-cols-2 gap-5 overflow-hidden min-h-0">
        <Panel><ThemeList /></Panel>
        <Panel><ThemeEditorAdvanced /></Panel>
      </div>
    </div>
  );
}
