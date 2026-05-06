import { AiChatEmptyState } from '@core/component/AI/component/AIChatEmptyState';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { Show } from 'solid-js';
import { Dialog, Panel } from '@ui';

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
      <Dialog
        open={macroMcpSetupOpen()}
        onOpenChange={setMacroMcpSetupOpen}
        class="w-[760px]"
      >
        <Panel depth={2} active>
          <div class="*:max-h-[75vh]">
            <AiChatEmptyState />
          </div>
        </Panel>
      </Dialog>
    </Show>
  );
}
