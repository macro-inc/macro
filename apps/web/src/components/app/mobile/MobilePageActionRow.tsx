import { SoupChatInput } from '@app/features/chat/SoupChatInput';
import { FloatRegion } from './float-regions/FloatRegion';
import { MobilePageCreateButton } from './MobilePageCreateButton';

/** The default mobile accessory: an AI composer beside the page's New action. */
export function MobilePageActionRow() {
  // Keep the editor and its draft alive while another accessory owns the slot.
  const composer = <SoupChatInput />;

  return (
    // Screen composers (0) and search scopes (100) take precedence.
    <FloatRegion region="accessory" priority={-1}>
      <div class="flex items-end gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter)">
        <div class="pointer-events-auto min-w-0 flex-1">{composer}</div>
        <MobilePageCreateButton />
      </div>
    </FloatRegion>
  );
}
