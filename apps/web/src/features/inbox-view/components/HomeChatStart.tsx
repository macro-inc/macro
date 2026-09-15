import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { ChatInputProvider } from '@core/component/AI/context';
import { HomeRecommendedActions } from '../../home/components/home-recommended-actions';
import { HomeChatInput } from '../../home/home-chat-input';

/** Desktop Home's idle pane uses the single-line chat composer and send flow. */
export function HomeChatStart() {
  return (
    <ChatInputProvider>
      <DragDropWrapper class="relative size-full min-h-0 min-w-0 overflow-y-auto px-6">
        <div class="mx-auto grid h-full min-h-64 min-w-0 w-full max-w-180 grid-cols-1 grid-rows-[1fr_auto_1fr] pb-16">
          <h1 class="mb-6 min-h-0 min-w-0 self-end text-center text-2xl font-normal leading-[42px] text-ink">
            What should we get done in Macro?
          </h1>
          <HomeChatInput
            variant="default"
            placeholder="Type @ to reference / for skills"
            autoFocusOnMount={false}
          />
          <div class="min-h-0 min-w-0 pb-8">
            <HomeRecommendedActions />
          </div>
        </div>
      </DragDropWrapper>
    </ChatInputProvider>
  );
}
