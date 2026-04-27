import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '@theme/components/ThemeEditorBasic';
import ThemeTools from '@theme/components/ThemeTools';
import ThemeList from '@theme/components/ThemeList';
import { isMobile } from '@core/mobile/isMobile';
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

      <div style={{
        'grid-template-columns': isMobile() ? '1fr' : '1fr 1fr',
        'overflow': 'hidden',
        'display': 'grid',
        'min-height': '0',
        'gap': '20px',
      }}>
        <Panel><ThemeList /></Panel>
        <Panel><ThemeEditorAdvanced /></Panel>
      </div>
    </div>
  );
}
