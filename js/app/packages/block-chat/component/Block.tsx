import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { DebouncedNotificationReadMarker } from '@notifications';
import { Show } from 'solid-js';
import { chatBlockData } from '../signal/chatBlockData';
import { Chat } from './Chat';
import { ModalsProvider } from './ModalsProvider';

export default function ChatBlock() {
  useBlockEntityCommands();
  const blockId = useBlockId();
  const notificationSource = useGlobalNotificationSource();
  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);

  return (
    <DocumentBlockContainer title={name()}>
      <div class="size-full bracket-never" tabIndex={-1}>
        <DebouncedNotificationReadMarker
          notificationSource={notificationSource}
          entity={{ type: 'chat', id: blockId }}
        />
        <ModalsProvider>
          <Show when={chatBlockData()}>{(data) => <Chat data={data()} />}</Show>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}
