import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { ChatInputProvider } from '@core/component/AI/context';
import { HomeRecommendedActions } from './components/home-recommended-actions';
import styles from './components/home-start.module.css';
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
              variant="tall"
              autoFocusOnMount={false}
              placeholder="Work on anything"
              class={styles.composer}
            />
          }
          suggestions={<HomeRecommendedActions />}
        />
      </DragDropWrapper>
    </ChatInputProvider>
  );
}
