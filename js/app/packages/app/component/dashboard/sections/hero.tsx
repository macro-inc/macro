import { QuickActionsSection } from '@app/component/dashboard/sections/quick-actions';
import { globalSplitManager } from '@app/signal/splitLayout';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import { ChatInputProvider } from '@core/component/AI/context';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { useUserContext } from '@core/context/user';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { createMemo } from 'solid-js';

const MACRO_LOGO_PATH =
  'm6.25 4.038-2.242 0.8792v5.8184l-1.756-1.6582-2.242 0.8792v6.6766c0 0.2568 0.106 0.502 0.292 0.6784l2.794 2.6422 2.244-0.879v-5.8184l7.084 6.6974 2.244-0.879v-5.8184l7.086 6.6976 2.24-0.8792v-6.6766c0-0.2568-0.104-0.5022-0.292-0.6784l-8.124-7.6816-2.244 0.879v5.8184z';

function AnimatedHeroLogo(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      class={props.class}
      display="block"
    >
      <defs>
        <clipPath id="dashboard-hero-logo-fill">
          <rect
            class="dashboard-logo-fill-clip"
            x="0"
            y="0"
            width="24"
            height="24"
          />
        </clipPath>
      </defs>
      <path d={MACRO_LOGO_PATH} fill="currentColor" opacity="0.12" />
      <path
        d={MACRO_LOGO_PATH}
        fill="currentColor"
        clip-path="url(#dashboard-hero-logo-fill)"
      />
    </svg>
  );
}

export function Hero() {
  const user = useUserContext();
  const firstName = createMemo(() => {
    const name = user.author();
    return name.includes('@') ? name.split('@')[0] : name.split(' ')[0];
  });

  const timeOfDay = createMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  });

  const greeting = createMemo(() => `Good ${timeOfDay()}`);

  const editor = buildChatEditor();

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
    <section class="relative">
      <style>{
        /*css*/ `
          @keyframes dashboard-hero-fade-up {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes dashboard-hero-logo-fill {
            from { transform: scaleX(0); }
            to   { transform: scaleX(1); }
          }
          .dashboard-hero-stagger > * {
            animation: dashboard-hero-fade-up 250ms ease-out both;
          }
          .dashboard-hero-stagger > *:nth-child(1) { animation-delay: 50ms; }
          .dashboard-hero-stagger > *:nth-child(2) { animation-delay: 120ms; }
          .dashboard-hero-stagger > *:nth-child(3) { animation-delay: 190ms; }
          .dashboard-logo-fill-clip {
            transform-box: fill-box;
            transform-origin: left center;
            animation: dashboard-hero-logo-fill 250ms cubic-bezier(0.2, 0.8, 0.2, 1) 50ms both;
          }
          @media (prefers-reduced-motion: reduce) {
            .dashboard-hero-stagger > *,
            .dashboard-logo-fill-clip {
              animation: none;
            }
          }
        `
      }</style>
      <div class="dashboard-hero-stagger mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 sm:px-0">
        <div class="flex w-full items-center gap-3 justify-center">
          <AnimatedHeroLogo class="size-6 text-accent" />
          <h1 class="relative min-w-0 text-balance text-2xl font-medium font-serif tracking-tight text-ink">
            {greeting()}, <span class="capitalize">{firstName()}</span>
          </h1>
        </div>

        <div class="flex flex-col gap-4 w-full text-left">
          <ChatInputProvider>
            <ChatInput
              variant="tall"
              editor={editor}
              onSend={handleSend}
              isPersistent
            />
          </ChatInputProvider>
          <div class="w-full flex items-center justify-between">
            <QuickActionsSection />
          </div>
        </div>
      </div>
    </section>
  );
}
