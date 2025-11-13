// import { ComputeTokens } from '../../../block-theme/ComputeTokens';

import { TabContent } from '@core/component/TabContent';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { ThemeEditorAdvanced } from '../../../block-theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '../../../block-theme/components/ThemeEditorBasic';
import ThemeList from '../../../block-theme/components/ThemeList';
import ThemeTools from '../../../block-theme/components/ThemeTools';

export function Appearance() {
  return (
    <TabContent title="Appearance">
      <div
        style={{
          'grid-template-rows': `min-content min-content ${isMobileWidth() ? '205px' : '269px'}`,
          display: 'grid',
          gap: '8px',
        }}
      >
        <ThemeTools />

        <div
          style={{
            'grid-template-columns': '1fr',
            display: 'grid',
            gap: '8px',
          }}
        >
          {/*<ComputeTokens />*/}
          <ThemeEditorBasic />
        </div>

        <div
          style={{
            'grid-template-columns': `${isMobileWidth() ? '1fr' : '1fr 1fr'}`,
            display: 'grid',
            gap: '8px',
          }}
        >
          <ThemeEditorAdvanced />
          <ThemeList />
        </div>
      </div>
    </TabContent>
  );
}
