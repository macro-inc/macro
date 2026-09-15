import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { ChatInputProvider } from '@core/component/AI/context';
import { HomeRecommendedActions } from './components/home-recommended-actions';
import { HomeStartLayout } from './components/home-start-layout';
import { HomeChatInput } from './home-chat-input';

/** Desktop inbox landing pane, sharing the original Home composer and recommendations. */
export function InboxStart() {
  return (
    <ChatInputProvider>
      <DragDropWrapper class="relative size-full">
        <HomeStartLayout
          composer={
            <HomeChatInput
              variant="default"
              autoFocusOnMount={false}
              placeholder="Work on anything"
            />
          }
          suggestions={<HomeRecommendedActions />}
        />
      </DragDropWrapper>
    </ChatInputProvider>
  );
}
