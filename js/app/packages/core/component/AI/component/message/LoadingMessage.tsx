import { GlitchText } from '@core/component/GlitchText';
import MacroGridLoader from '@macro-icons/macro-grid-noise-loader-4.svg';
import type { ChatAttachmentWithName } from '@service-cognition/generated/schemas/chatAttachmentWithName';
import { createCallback } from '@solid-primitives/rootless';
import { createEffect, createSignal, untrack } from 'solid-js';

export function LoadingMessage(props: {
  attachments: ChatAttachmentWithName[];
}) {
  const [currentMessage, setCurrentMessage] = createSignal<number>(0);

  const [timeoutHandle, setTimeoutHandle] =
    createSignal<ReturnType<typeof setTimeout>>();
  const messages = createCallback(() => {
    return [
      { text: 'Thinking...', time: 1300 },
      { text: 'Understanding...', time: 1300 },
      ...props.attachments
        .map((a) => {
          if (a.metadata?.type !== 'document') return undefined;
          return {
            text: `Reading through ${a.metadata?.document_name}...`,
            time: 3000,
          };
        })
        .filter((a) => a !== undefined),
      { text: 'Generating Response...', time: 5000 },
    ];
  });

  createEffect(() => {
    let currentMessage_ = currentMessage();
    messages();
    let handle = untrack(timeoutHandle);
    if (handle) {
      clearTimeout(handle);
    }
    const newHandle = setTimeout(() => {
      setCurrentMessage((prev) => {
        return (prev + 1) % messages().length;
      });
    }, messages()[currentMessage_].time);
    setTimeoutHandle(newHandle);
  });

  return (
    <div class="py-2 font-mono text-sm flex items-center gap-2">
      <MacroGridLoader width={20} height={20} class="text-accent" />
      <GlitchText from={messages()[currentMessage()].text} continuous />
    </div>
    // <p class="h-[32px] flex flex-row items-center justify-start w-full px-2 text-ink-muted animate-pulse text-sm">

    // {messages()[currentMessage()].text}
    // </p>
  );
}
