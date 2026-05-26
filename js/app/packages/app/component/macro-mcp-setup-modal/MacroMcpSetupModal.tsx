import { AiChatEmptyState } from '@core/component/AI/component/AIChatEmptyState';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { Dialog, Surface } from '@ui';
import { Show } from 'solid-js';

const [macroMcpSetupOpen, setMacroMcpSetupOpen] = createControlledOpenSignal(
  false,
  {
    id: 'macro-mcp-setup',
  }
);

export const openMacroMcpSetupModal = () => {
  setMacroMcpSetupOpen(true);
};

const _closeMacroMcpSetupModal = () => {
  setMacroMcpSetupOpen(false);
};

export function MacroMcpSetupModal() {
  return (
    <Show when={macroMcpSetupOpen()}>
      <Dialog
        open={macroMcpSetupOpen()}
        onOpenChange={setMacroMcpSetupOpen}
        class="w-190"
      >
        <Surface depth={2} active class="rounded-xl">
          <div class="*:max-h-[75vh]">
            <AiChatEmptyState />
          </div>
        </Surface>
      </Dialog>
    </Show>
  );
}
