import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SidePanel } from '@app/component/side-panel';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { DebouncedNotificationReadMarker } from '@notifications';
import { Show } from 'solid-js';
import { chatBlockData } from '../signal/chatBlockData';
import { Chat } from './Chat';
import { ModalsProvider } from './ModalsProvider';
import { ChatSidePanelSections } from './sidepanel/ChatSidePanelSections';

export default function ChatBlock() {
  useBlockEntityCommands();
  const blockId = useBlockId();
  const notificationSource = useGlobalNotificationSource();
  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);

  return (
    <DocumentBlockContainer title={name()}>
      <div class="size-full" tabIndex={-1}>
        <DebouncedNotificationReadMarker
          notificationSource={notificationSource}
          entity={{ type: 'chat', id: blockId }}
        />
        <ModalsProvider>
          <SidePanel.Layout defaultOpen={false}>
            <ChatSidePanelSections />
            <Show when={chatBlockData()}>
              {(data) => <Chat data={data()} />}
            </Show>
          </SidePanel.Layout>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}
