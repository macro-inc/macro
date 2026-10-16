import { SoupChatInput } from '@app/features/chat/SoupChatInput';
import { activeElement } from '@app/signal/focus';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import { Show } from 'solid-js';
import { FloatRegion } from './float-regions/FloatRegion';
import { MobilePageCreateButton } from './MobilePageCreateButton';
import { useForegroundMobileView } from './use-mobile-nav';

/** The page's New action, or an AI composer on the Agents view. */
export function MobilePageActionRow() {
  // Keep the editor and its draft alive while typing elsewhere or while another
  // accessory owns the slot.
  const foregroundView = useForegroundMobileView();
  const showsComposer = () => foregroundView() === 'agents';
  let composerRef: HTMLDivElement | undefined;
  const composer = (
    <Show when={showsComposer()}>
      <div ref={composerRef} class="pointer-events-auto min-w-0 flex-1">
        <SoupChatInput />
      </div>
    </Show>
  );
  const isAvailable = () => {
    if (!showsComposer() && virtualKeyboardVisible()) return false;
    const focused = activeElement();
    return (
      !isEditableInput(focused) ||
      (showsComposer() && !!composerRef?.contains(focused))
    );
  };

  return (
    // Screen composers (0) and search scopes (100) take precedence.
    <FloatRegion region="accessory" priority={-1} active={isAvailable}>
      <div class="flex items-end justify-end gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter)">
        {composer}
        <MobilePageCreateButton />
      </div>
    </FloatRegion>
  );
}
