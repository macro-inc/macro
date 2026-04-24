import { ThemeEditorAdvanced } from '../../../theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '../../../theme/components/ThemeEditorBasic';
import ThemeTools from '../../../theme/components/ThemeTools';
import ThemeList from '../../../theme/components/ThemeList';

export function Appearance() {
  return (
      <div
        class="absolute inset-0 overflow-hidden bg-edge-muted @container gap-px grid grid-cols-1 grid-rows-[min-content_min-content_1fr_1fr] @[650px]:grid-cols-2 @[650px]:grid-rows-[min-content_min-content_1fr]"
      >
        <div class="@[650px]:col-span-2"><ThemeTools /></div>
        <div class="@[650px]:col-span-2"><ThemeEditorBasic /></div>
        <div class="overflow-hidden"><ThemeList/></div>
        <div class="overflow-hidden"><ThemeEditorAdvanced /></div>
      </div>
  );
}
