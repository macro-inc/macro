import { SoupChatInput } from '@app/features/chat/SoupChatInput';
import { activeElement } from '@app/signal/focus';
import { isEditableInput } from '@core/util/isEditableInput';
import { FloatRegion } from './float-regions/FloatRegion';
import { MobilePageCreateButton } from './MobilePageCreateButton';

/** The default mobile accessory: an AI composer beside the page's New action. */
export function MobilePageActionRow() {
  // Keep the editor and its draft alive while typing elsewhere or while another
  // accessory owns the slot.
  let composerRef!: HTMLDivElement;
  const composer = (
    <div ref={composerRef} class="pointer-events-auto min-w-0 flex-1">
      <SoupChatInput />
    </div>
  );
  const isAvailable = () => {
    const focused = activeElement();
    return !isEditableInput(focused) || composerRef.contains(focused);
  };

  return (
    // Screen composers (0) and search scopes (100) take precedence.
    <FloatRegion region="accessory" priority={-1} active={isAvailable}>
      <div class="flex items-end gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter)">
        {composer}
        <MobilePageCreateButton />
      </div>
    </FloatRegion>
  );
}
