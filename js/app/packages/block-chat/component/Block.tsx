import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { createEffect, createSignal, Show } from 'solid-js';
import { chatBlockData } from '../signal/chatBlockData';
import { Chat } from './Chat';
import { ModalsProvider } from './ModalsProvider';

export default function ChatBlock() {
  const [title, setTitle] = createSignal<string>(DEFAULT_CHAT_NAME);

  createEffect(() => {
    const data = chatBlockData();
    if (data) {
      setTitle(data.chat.name);
    }
  });

  return (
    <DocumentBlockContainer title={title()}>
      <ModalsProvider>
        <div class="size-full bracket-never" tabIndex={-1}>
          <Show when={chatBlockData()}>{(data) => <Chat data={data()} />}</Show>
        </div>
      </ModalsProvider>
    </DocumentBlockContainer>
  );
}
