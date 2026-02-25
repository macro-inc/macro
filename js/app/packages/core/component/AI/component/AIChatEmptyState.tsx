import { modifierMap } from '@core/component/Hotkey';
import { Show } from 'solid-js';
import { useOpenInstructionsMd } from '../util/instructions';
import { isMobile } from '@core/mobile/isMobile';

export function AiChatEmptyState() {
  const openInstructions = useOpenInstructionsMd();
  return (
    <div class="relative p-2 border border-edge-muted bg-dialog text-sm flex flex-col gap-2 text-ink macro-message-margin">
      <Show when={!isMobile()}>
        <div class="grid justify-start grid-cols-[max-content_auto] gap-y-1 grid-template items-center">
          <span class="p-1 bg-accent text-panel mr-2 text-center">@</span>
          <span>To attach, files, emails, and channel</span>
        </div>
        <div class="grid justify-start grid-cols-[max-content_auto] gap-y-1 grid-template items-center">
          <span class="p-1 bg-accent text-panel mr-2 text-center">Enter</span>
          <span>To chat with Haiku</span>
        </div>
        <div class="grid justify-start grid-cols-[max-content_auto] gap-y-1 grid-template items-center">
          <span class="p-1 bg-accent text-panel mr-2 text-center">
            {modifierMap.cmd} + Enter
          </span>
          <span>To chat with Opus</span>
        </div>
        <div class="grid justify-start grid-cols-[max-content_auto] gap-y-1 grid-template items-center">
          <span class="p-1 bg-accent text-panel mr-2 text-center">
            {modifierMap.ctrl} + C
          </span>
          <span>To Stop generating</span>
        </div>
      </Show>
      <div>
        Change the
        <span
          class="font-medium text-accent underline mx-1"
          onClick={openInstructions}
        >
          Instructions
        </span>
        to feed AI some basic context on what you do, who you work with, etc
      </div>
    </div>
  );
}
