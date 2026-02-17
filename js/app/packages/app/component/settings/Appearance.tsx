import { ThemeEditorAdvanced } from '../../../block-theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '../../../block-theme/components/ThemeEditorBasic';
import ThemeTools from '../../../block-theme/components/ThemeTools';
import ThemeList from '../../../block-theme/components/ThemeList';

export function Appearance() {
  return (
      <div
        class="absolute inset-0 overflow-hidden bg-edge-muted @container gap-px grid grid-cols-1 grid-rows-[min-content_min-content_1fr_1fr] @[650px]:grid-cols-2 @[650px]:grid-rows-[min-content_min-content_1fr] mobile:flex"
      >
        <div class="mobile:hidden @[650px]:col-span-2"><ThemeTools /></div>
        <div class="mobile:hidden @[650px]:col-span-2"><ThemeEditorBasic /></div>
        <div class="mobile:flex-1 overflow-hidden"><ThemeList/></div>
        <div class="mobile:hidden overflow-hidden"><ThemeEditorAdvanced /></div>
      </div>
  );
}
