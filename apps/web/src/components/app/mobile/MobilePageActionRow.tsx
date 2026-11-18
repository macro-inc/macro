import { MobileAgentComposer } from '@app/features/agents-view/mobile-agent-composer';
import { activeElement } from '@app/signal/focus';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';
import { FloatRegion } from './float-regions/FloatRegion';
import { MobilePageCreateButton } from './MobilePageCreateButton';
import { useForegroundMobileView } from './use-mobile-nav';

/** The page's New action, or an AI composer on the Agents view. */
export function MobilePageActionRow() {
  // Keep the editor and its draft alive while typing elsewhere or while another
  // accessory owns the slot.
  const foregroundView = useForegroundMobileView();
  const showsComposer = () => foregroundView() === 'agents';
  // The composer is the heaviest thing a phone mounts on a navigation, and
  // Agents becomes the foreground view inside the tap. Mounting it a task
  // after the next frame lets that frame answer the tap; a blank of the
  // collapsed composer's height holds the row meanwhile.
  const [composerDue, setComposerDue] = createSignal(false);
  createEffect(
    on(showsComposer, (shows) => {
      if (!shows) return;

      let timer: ReturnType<typeof setTimeout> | undefined;
      const mountSoon = () => {
        timer = setTimeout(() => setComposerDue(true));
      };
      // A hidden page gets no frames; the task alone still frees the tap.
      const hidden = document.visibilityState === 'hidden';
      const frame = hidden ? undefined : requestAnimationFrame(mountSoon);
      if (hidden) mountSoon();

      onCleanup(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        clearTimeout(timer);
        setComposerDue(false);
      });
    })
  );
  let composerRef: HTMLDivElement | undefined;
  const composer = (
    <Show when={showsComposer()}>
      <div ref={composerRef} class="pointer-events-auto min-w-0 flex-1">
        <Show
          when={composerDue()}
          fallback={<div class="h-(--mobile-chrome-button-size)" />}
        >
          <MobileAgentComposer />
        </Show>
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
    // Screen composers (0) and search (100) take precedence.
    <FloatRegion region="accessory" priority={-1} active={isAvailable}>
      <div class="group/mobile-composer flex items-end justify-end gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter)">
        {composer}
        <div class="shrink-0 empty:hidden group-has-[[data-composer-expanded=true]]/mobile-composer:hidden">
          <MobilePageCreateButton />
        </div>
      </div>
    </FloatRegion>
  );
}
