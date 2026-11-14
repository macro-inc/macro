import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel } from '@components/app/side-panel';
import { Show } from 'solid-js';
import { DispatchAgentButton } from '../component/DispatchAgentMenu';
import { useMarkdownName } from '../component/MarkdownNameProvider';
import { useMarkdownDocument } from '../context/markdown-document-context';

/**
 * Dispatch Agent, on a task, and Ask Macro, shown before Share in a desktop
 * document header.
 */
export function MarkdownHeaderActions() {
  const { documentId, kind } = useMarkdownDocument();
  const { displayName } = useMarkdownName();

  return (
    <SidePanel.HeaderActions>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={kind() === 'task'}>
          <DispatchAgentButton showPrimaryLabel />
        </Show>
        <HeaderActionGroup label="Actions">
          <AskMacroButton
            grouped
            entity={{
              type: 'document',
              id: documentId(),
              name: displayName() ?? '',
              fileType: 'md',
            }}
          />
        </HeaderActionGroup>
      </div>
    </SidePanel.HeaderActions>
  );
}
