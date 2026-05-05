import { AiChatEmptyState } from '@core/component/AI/component/AIChatEmptyState';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { Show } from 'solid-js';
import { Backdrop, Panel } from '@ui';

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
      <Backdrop
        open={macroMcpSetupOpen()}
        onOpenChange={setMacroMcpSetupOpen}
        width="760px"
      >
        <Panel depth={2} active>
          <div class="*:max-h-[75vh]">
            <AiChatEmptyState />
          </div>
        </Panel>
      </Backdrop>
    </Show>
  );
}
