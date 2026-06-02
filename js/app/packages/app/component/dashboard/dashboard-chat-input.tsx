import { globalSplitManager } from '@app/signal/splitLayout';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import { ChatInputProvider } from '@core/component/AI/context';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import type { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { cognitionApiServiceClient } from '@service-cognition/client';

export function DashboardAiInput(props: { editor?: EditorConfigBuilder }) {
  const editor = props.editor ?? buildChatEditor();

  const handleSend = async (request: ChatSendInput) => {
    const response = await cognitionApiServiceClient.createChat({});
    if (response.isErr()) return;

    setPendingSendData({
      content: request.content,
      attachments: request.attachments,
      model: request.model,
    });

    globalSplitManager()?.openWithSplit(
      { type: 'chat', id: response.value.id },
      {
        activate: true,
        referredFrom: null,
        preferNewSplit: request.metaKey,
      }
    );
  };

  return (
    <ChatInputProvider>
      <ChatInput
        variant="tall"
        editor={editor}
        onSend={handleSend}
        isPersistent
      />
    </ChatInputProvider>
  );
}
