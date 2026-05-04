import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';

import { isMobile } from '@core/mobile/isMobile';
import { Panel } from '@ui';
import { cn } from '@ui/utils/classname';

export function Appearance() {
  return (
    <div
      style={{
        'grid-template-rows': 'min-content 1fr',
        'grid-template-columns': '1fr',
        'overflow': 'hidden',
        'display': 'grid',
        'height': '100%',
        'padding': '8px',
        'gap': '8px',
      }}
    >
      <Panel depth={2}>
        <ThemeTools />
        <ThemeEditorBasic />
      </Panel>

      <div class="@container grid grid-cols-1 @[700px]:grid-cols-2 gap-2 overflow-hidden min-h-0">
        <Panel depth={2}>
          <ThemeList />
        </Panel>
        <div class={cn('contents', isMobile() && 'hidden')}>
          <Panel depth={2}>
            <ThemeEditorAdvanced />
          </Panel>
        </div>
      </div>
    </div>
  );
}
