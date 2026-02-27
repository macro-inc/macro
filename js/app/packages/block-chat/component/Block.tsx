import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { DebouncedNotificationReadMarker } from '@notifications';
import { createEffect, createSignal, Show } from 'solid-js';
import { chatBlockData } from '../signal/chatBlockData';
import { Chat } from './Chat';
import { ModalsProvider } from './ModalsProvider';

export default function ChatBlock() {
  const [title, setTitle] = createSignal<string>(DEFAULT_CHAT_NAME);
  const blockId = useBlockId();
  const notificationSource = useGlobalNotificationSource();

  createEffect(() => {
    const data = chatBlockData();
    if (data) {
      setTitle(data.chat.name);
    }
  });

  return (
    <DocumentBlockContainer title={title()}>
      <DebouncedNotificationReadMarker
        notificationSource={notificationSource}
        entity={{ type: 'chat', id: blockId }}
      />
      <div class="size-full bracket-never" tabIndex={-1}>
        <ModalsProvider>
          <Show when={chatBlockData()}>{(data) => <Chat data={data()} />}</Show>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}
