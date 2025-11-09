import { useLocation } from '@solidjs/router';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';

export const [showChatLightbox, setShowChatLightbox] = createSignal(false);

export function ChatLightbox() {
  const [showTooltip, setShowTooltip] = createSignal(false);
  const [chatInputTop, setChatInputTop] = createSignal<number>(0);
  const [chatInputLeft, setChatInputLeft] = createSignal<number>(0);
  const [chatInputWidth, setChatInputWidth] = createSignal<number>(0);
  const [chatInputHeight, setChatInputHeight] = createSignal<number>(0);

  const [chatInputButtonTop, setChatInputButtonTop] = createSignal<number>(0);
  const [chatInputButtonLeft, setChatInputButtonLeft] = createSignal<number>(0);
  const [chatInputButtonWidth, setChatInputButtonWidth] =
    createSignal<number>(0);
  const [chatInputButtonHeight, setChatInputButtonHeight] =
    createSignal<number>(0);

  const location = useLocation();

  const updateChatRect = () => {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;
    const chatInputRect = chatInput.getBoundingClientRect();
    setChatInputTop(chatInputRect.top);
    setChatInputLeft(chatInputRect.left);
    setChatInputWidth(chatInputRect.width);
    setChatInputHeight(chatInputRect.height);
  };

  const updateChatInputButtonRect = () => {
    const chatInputButton = document.getElementById('chat-input-button');
    if (!chatInputButton) return;
    const chatInputButtonRect = chatInputButton.getBoundingClientRect();
    setChatInputButtonTop(chatInputButtonRect.top);
    setChatInputButtonLeft(chatInputButtonRect.left);
    setChatInputButtonWidth(chatInputButtonRect.width);
    setChatInputButtonHeight(chatInputButtonRect.height);
  };

  // Update on location changes
  createEffect(() => {
    if (location.pathname === '/app/start/block') {
      let interval: number | undefined;
      let resizeObserver: ResizeObserver | undefined;

      const setupChatInput = () => {
        const chatInput = document.getElementById('chat-input');
        if (!chatInput) return false;

        const editable = chatInput.querySelector(
          'div[contenteditable="plaintext-only"]'
        );
        if (editable) {
          (editable as HTMLElement).blur();
        }

        window.addEventListener('resize', updateChatRect);
        window.addEventListener('scroll', updateChatRect);
        window.addEventListener('resize', updateChatInputButtonRect);
        window.addEventListener('scroll', updateChatInputButtonRect);

        resizeObserver = new ResizeObserver(() => {
          updateChatRect();
          updateChatInputButtonRect();
        });
        resizeObserver.observe(chatInput);

        updateChatRect();
        updateChatInputButtonRect();
        return true;
      };

      interval = window.setInterval(() => {
        if (setupChatInput()) {
          clearInterval(interval);
        }
      }, 50);

      onCleanup(() => {
        if (interval) clearInterval(interval);
        if (resizeObserver) resizeObserver.disconnect();
        window.removeEventListener('resize', updateChatRect);
        window.removeEventListener('scroll', updateChatRect);
        window.removeEventListener('resize', updateChatInputButtonRect);
        window.removeEventListener('scroll', updateChatInputButtonRect);
      });
    }
  });

  const checkMobile = () => {
    const isMobile = window.innerWidth < 640;
    if (isMobile) {
      setShowChatLightbox(false);
    }
  };

  onMount(() => {
    checkMobile();
    setTimeout(() => {
      setShowTooltip(true);
    }, 3000);
    window.addEventListener('resize', checkMobile);
    onCleanup(() => {
      window.removeEventListener('resize', checkMobile);
    });
  });

  return (
    <Show when={showChatLightbox()}>
      <div
        class="z-999 fixed inset-0 pointer-events-none hidden sm:block"
        onClick={() => {
          setShowTooltip(true);
        }}
        style={{
          opacity: showChatLightbox() ? 1 : 0,
          transition: 'opacity 0.3s ease-in-out',
        }}
      >
        {/* Top section */}
        <div
          class="absolute top-0 left-0 w-full pointer-events-auto"
          style={{ height: `${chatInputTop()}px` }}
        >
          <div class="w-full h-full bg-ink/20" />
        </div>

        {/* Middle section with hole for chat input */}
        <div
          class="absolute w-full flex justify-between z-[1]"
          style={{
            top: `${chatInputTop()}px`,
            height: `${chatInputHeight()}px`,
          }}
        >
          {/* Left of chat input */}
          <div
            class="h-full bg-ink/20 pointer-events-auto overflow-hidden"
            style={{ width: `${chatInputLeft()}px` }}
          />

          <div
            class="h-full grow-1 relative outline-5 outline-[#AAAAAA] shadow-xl rounded-xl"
            style={{
              'box-shadow': '0px 0px 20px 0px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* top section */}
            <div
              class="absolute top-0 left-0 w-full pointer-events-auto"
              style={{
                height: `${chatInputHeight() - chatInputButtonHeight() - 8}px`,
              }}
            />

            {/* left section */}
            <div
              class="absolute top-0 left-0 h-full pointer-events-auto"
              style={{
                width: `${chatInputWidth() - chatInputButtonWidth() - 8}px`,
              }}
            />
          </div>

          {/* Right of chat input */}
          <div
            class="h-full bg-ink/20 pointer-events-auto"
            style={{
              width: `calc(100% - ${chatInputLeft()}px - ${chatInputWidth()}px)`,
            }}
          />
        </div>

        {/* Create a blue pulsing effect on the chat input button */}
        <div
          class="absolute w-full pointer-events-none z-[2]"
          style={{
            top: `${chatInputButtonTop()}px`,
            height: `${chatInputButtonHeight()}px`,
            width: `${chatInputButtonWidth()}px`,
            left: `${chatInputButtonLeft()}px`,
          }}
        >
          <div
            class="absolute top-1/2 -left-2 bg-accent text-panel rounded-lg px-2 py-1 text-xs -translate-x-full -translate-y-1/2 whitespace-nowrap"
            style={{
              opacity: showTooltip() ? 1 : 0,
              transition: 'opacity 0.3s ease-in-out',
            }}
          >
            Click here to get started
            {/* create a triangle right arrow */}
            <div class="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 bg-accent rotate-45" />
          </div>
          <div class="w-full h-full bg-accent/30 rounded-full animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
          <div class="absolute inset-0 bg-accent/20 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
        </div>

        {/* Bottom section */}
        <div
          class="absolute w-full bg-ink/20 pointer-events-auto"
          style={{
            top: `${chatInputTop() + chatInputHeight()}px`,
            bottom: 0,
          }}
        />
      </div>
    </Show>
  );
}
