import { BrightJoins } from '@ui/components/BrightJoins';
import { useOpenInstructionsMd } from '../util/instructions';

export function AiChatEmptyState() {
  const openInstructions = useOpenInstructionsMd();
  return (
    <div class="relative p-2 border border-edge-muted bg-dialog text-sm flex flex-col gap-2 text-ink">
      <BrightJoins dots={[true, true, true, true]} />
      <div class="grid justify-start grid-cols-[max-content_auto] gap-y-1 grid-template items-center">
        <span class="p-1 bg-accent text-panel mr-2 text-center">@</span>
        <span>To attach, files, emails, and channel</span>
      </div>
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
