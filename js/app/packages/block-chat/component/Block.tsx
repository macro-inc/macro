import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { createEffect, createSignal, Show } from 'solid-js';
import { chatBlockData } from '../signal/chatBlockData';
import { Chat } from './Chat';

export default function ChatBlock() {
  const [title, setTitle] = createSignal<string>('New Chat');

  createEffect(() => {
    const data = chatBlockData();
    if (data) {
      setTitle(data.chat.name);
    }
  });

  return (
    <DocumentBlockContainer title={title()}>
      <Show when={chatBlockData()}>{(data) => <Chat data={data()} />}</Show>
    </DocumentBlockContainer>
  );
}
