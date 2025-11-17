import { BrightJoins } from '@core/component/BrightJoins';
import { useSettingsState } from '@core/constant/SettingsState';
import { useOpenInstructionsMd } from '../util/instructions';

export function AiChatEmptyState() {
  const { setActiveTabId, openSettings } = useSettingsState();
  const openInstructions = useOpenInstructionsMd();
  console.log('aichat empty state ');
  return (
    <div class="relative p-2 border border-edge-muted bg-dialog text-sm flex flex-col gap-2 text-ink">
      <BrightJoins dots={[true, true, true, true]} />
      <div class="grid justify-start grid-cols-[max-content_max-content] gap-y-1 grid-template items-center">
        <span class="p-1 bg-accent text-panel mr-2 text-center">@</span>
        <span>To attach, files, emails, and channel</span>
        <span class="p-1 bg-accent text-panel mr-2 text-center">Agent</span>
        <span>
          <span>
            Let AI think and search through your files, emails, and channels
          </span>
        </span>
        <span class="p-1 bg-accent text-panel mr-2 text-center">Ask</span>
        <span>
          Quick answers to quick quesions with access to any files @ mentioned
        </span>
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
      <div>
        Check your AI
        <span
          class="font-medium text-accent underline mx-1"
          onClick={() => {
            setActiveTabId('AI Memory');
            openSettings();
          }}
        >
          {' '}
          Memories
        </span>
        that are auto-generated for accuracy and relevance
      </div>
    </div>
  );
}
