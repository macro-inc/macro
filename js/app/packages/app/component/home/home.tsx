import { useAnalytics } from '@app/component/analytics-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import { ENABLE_HOME_OVERRIDE } from '@core/constant/featureFlags';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { useUserContext } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isPaymentError } from '@core/util/handlePaymentError';
import { createRenameDssEntityMutation } from '@macro-entity';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { Navigate } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { HomeBackfillProgress } from './home-backfill-progress';
import { HomeHub } from './home-hub';
import { dismissCard, isDismissed } from './home-prefs';
import { HomeSectionBoundary } from './home-section-boundary';

type HomeExample = {
  icon: (props: { class?: string; triggerAnimation?: boolean }) => JSX.Element;
  title: string;
  description: string;
  prompt: string;
};

const HOME_EXAMPLES: HomeExample[] = [
  {
    icon: AnimatedFileMdIcon,
    title: 'Draft a document',
    description: 'Start from an idea',
    prompt: 'Help me draft a document about ',
  },
  {
    icon: AnimatedEmailIcon,
    title: 'Draft an email',
    description: 'Reply or compose',
    prompt: 'Help me draft an email to ',
  },
  {
    icon: AnimatedSearchIcon,
    title: 'Search & research',
    description: 'Across your workspace',
    prompt: 'Research and summarize everything we have about ',
  },
];

function XIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function HomeExamples() {
  const input = useChatInputContext();
  const [hovered, setHovered] = createSignal<number | null>(null);

  return (
    <Show when={!isDismissed('examples')}>
      <section>
        <div class="mb-2 flex items-center justify-between px-1">
          <span class="text-sm text-ink-muted">
            Get started with some examples
          </span>
          <button
            type="button"
            class="rounded-md p-1 text-ink-extra-muted transition-colors hover:bg-hover hover:text-ink-muted"
            aria-label="Dismiss examples"
            onClick={() => dismissCard('examples')}
          >
            <XIcon class="size-3.5" />
          </button>
        </div>
        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <For each={HOME_EXAMPLES}>
            {(example, i) => (
              <button
                type="button"
                class="group flex flex-col gap-1 rounded-xl border border-edge-muted bg-active p-3 text-left transition-colors hover:bg-hover"
                onClick={() => input.setPendingDraft(example.prompt)}
                onMouseEnter={() => setHovered(i())}
                onMouseLeave={() =>
                  setHovered((prev) => (prev === i() ? null : prev))
                }
              >
                <div class="flex items-center gap-2">
                  <Dynamic
                    component={example.icon}
                    triggerAnimation={hovered() === i()}
                    class="size-4 shrink-0 text-ink-muted transition-colors group-hover:text-accent"
                  />
                  <span class="text-sm font-medium text-ink">
                    {example.title}
                  </span>
                </div>
                <span class="truncate text-xs text-ink-muted">
                  {example.description}
                </span>
              </button>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

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
        <clipPath id="home-hero-logo-fill">
          <rect
            class="home-logo-fill-clip"
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
        clip-path="url(#home-hero-logo-fill)"
      />
    </svg>
  );
}

export function Home() {
  return (
    <ShowFeatureFlag
      key="enable-home-view"
      enabledOverride={ENABLE_HOME_OVERRIDE}
      fallback={<Navigate href="/" />}
    >
      <ChatInputProvider>
        <DragDropWrapper class="relative size-full">
          <HomeContent />
        </DragDropWrapper>
      </ChatInputProvider>
    </ShowFeatureFlag>
  );
}

function HomeContent() {
  const user = useUserContext();

  const firstName = createMemo(() => {
    const name = user.author();
    return name.includes('@') ? name.split('@')[0] : name.split(' ')[0];
  });

  const greeting = createMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  });

  return (
    <main class="relative flex h-full flex-col bg-surface">
      <style>{
        /*css*/ `
          @keyframes home-hero-logo-fill {
            from { transform: scaleX(0); }
            to   { transform: scaleX(1); }
          }
          @keyframes home-fade-in {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .home-logo-fill-clip {
            transform-box: fill-box;
            transform-origin: left center;
            animation: home-hero-logo-fill 550ms cubic-bezier(0.2, 0.8, 0.2, 1) 50ms both;
          }
          .home-content { animation: home-fade-in 280ms ease-out both; }
          @media (prefers-reduced-motion: reduce) {
            .home-logo-fill-clip, .home-content { animation: none; }
          }
        `
      }</style>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="home-content mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-6 pt-10 md:pt-16">
          <header class="flex items-center gap-2.5">
            <AnimatedHeroLogo class="size-6 shrink-0 text-accent" />
            <h1 class="text-2xl font-normal tracking-tight text-ink">
              {greeting()}, <span class="capitalize">{firstName()}</span>
            </h1>
          </header>

          <HomeSectionBoundary title="import">
            <HomeBackfillProgress />
          </HomeSectionBoundary>

          <HomeSectionBoundary title="hub">
            <HomeHub />
          </HomeSectionBoundary>

          <HomeSectionBoundary title="examples">
            <HomeExamples />
          </HomeSectionBoundary>
        </div>
      </div>

      <div class="shrink-0">
        <div class="mx-auto w-full max-w-3xl px-4 pb-3 mobile:px-(--mobile-chrome-gutter) mobile:pb-(--mobile-content-inset-bottom)">
          <div class="pointer-events-auto">
            <HomeChatInput />
          </div>
        </div>
      </div>
    </main>
  );
}

const HomeChatInput = () => {
  const analytics = useAnalytics();
  const splitPanelContext = useSplitPanelOrThrow();
  const input = useChatInputContext();

  const { getAttachmentFromMention } = useGetChatAttachmentInfo();

  const editor = buildChatEditor().withMentions({
    onCreate: (mention) => {
      analytics.track('mentions_menu_use', { itemType: 'chat' });
      const attachment = getAttachmentFromMention(mention);
      if (attachment) input.attachments.addAttachment(attachment);
    },
    block: 'chat',
    showOpenTabs: true,
  });

  const applyDraft = (text: string) => {
    editor.controls.setMarkdown(text);
    requestAnimationFrame(() => editor.controls.focus());
  };

  // Drafts requested from elsewhere on the home (e.g. a suggested action row).
  createEffect(() => {
    const draft = input.pendingDraft();
    if (draft != null) {
      applyDraft(draft);
      input.setPendingDraft(null);
    }
  });

  registerHotkey({
    hotkey: 'enter',
    scopeId: splitPanelContext.splitHotkeyScope,
    description: 'Focus Chat Input',
    keyDownHandler: () => {
      editor.controls.focus();
      return true;
    },
    hotkeyToken: TOKENS.block.focus,
    hide: true,
  });

  const renameMutation = createRenameDssEntityMutation();

  const handleSend = async (request: ChatSendInput) => {
    const backgroundSend = request.metaKey;

    // Create a new persistent chat
    const response = await cognitionApiServiceClient.createChat({});
    if (response.isErr()) {
      if (isPaymentError(response)) {
        const { showPaywall } = usePaywallState();
        showPaywall(PaywallKey.CHAT_LIMIT);
      }
      return;
    }
    const { id: chatId } = response.value;

    // Rename via mutation for optimistic cache updates (history, preview, soup)
    const name = deriveChatName(request.content);
    if (name) {
      renameMutation.mutate({
        entity: { type: 'chat', id: chatId, name: '', ownerId: '' },
        newName: name,
      });
    }

    if (backgroundSend) {
      // Send the message in the background without navigating
      cognitionApiServiceClient.sendStreamChatMessage({
        content: request.content,
        model: request.model,
        chat_id: chatId,
        attachments:
          request.attachments.length > 0 ? request.attachments : undefined,
        toolset: { type: 'all' },
      });
      invalidateAllSoup();
    } else {
      // Store the pending send data for the chat to pick up
      setPendingSendData({
        content: request.content,
        attachments: request.attachments,
        model: request.model,
      });

      // Replace the soup split with the chat split
      splitPanelContext.handle.replace({
        next: { type: 'chat', id: chatId },
      });
    }
  };

  return (
    <ChatInput
      variant="default"
      editor={editor}
      onSend={handleSend}
      onEscape={() => {
        splitPanelContext.panelRef()?.focus();
        return true;
      }}
      isPersistent={true}
      autoFocusOnMount={true}
    />
  );
};
