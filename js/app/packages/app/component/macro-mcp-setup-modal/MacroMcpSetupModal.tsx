import { AiChatEmptyState } from '@core/component/AI/component/AIChatEmptyState';
import { DialogWrapper } from '@core/component/DialogWrapper';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { Dialog } from '@kobalte/core/dialog';
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

export const closeMacroMcpSetupModal = () => {
  setMacroMcpSetupOpen(false);
};

export function MacroMcpSetupModal() {
  return (
    <Show when={macroMcpSetupOpen()}>
      <Dialog open={macroMcpSetupOpen()} onOpenChange={setMacroMcpSetupOpen}>
        <Dialog.Portal>
          <DialogWrapper width="760px">
            <AiChatEmptyState />
          </DialogWrapper>
        </Dialog.Portal>
      </Dialog>
    </Show>
  );
}
