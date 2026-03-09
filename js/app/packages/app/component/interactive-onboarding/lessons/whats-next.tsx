import { onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function WhatsNextContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3">
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        You're all set! Here are a few more things you can explore on your own:
      </p>
      <ul class="flex flex-col gap-2 text-sm text-ink/70 list-disc pl-4">
        <li
          style={{ animation: 'onboarding-fade-up 300ms ease-out 120ms both' }}
        >
          Press{' '}
          <kbd class="px-1.5 py-0.5 rounded bg-hover/50 font-mono text-xs">
            Enter
          </kbd>{' '}
          to open the focused item.
        </li>
        <li
          style={{ animation: 'onboarding-fade-up 300ms ease-out 200ms both' }}
        >
          Press{' '}
          <kbd class="px-1.5 py-0.5 rounded bg-hover/50 font-mono text-xs">
            &#8984;
          </kbd>
          +
          <kbd class="px-1.5 py-0.5 rounded bg-hover/50 font-mono text-xs">
            K
          </kbd>{' '}
          to open the command menu and search for anything.
        </li>
        <li
          style={{ animation: 'onboarding-fade-up 300ms ease-out 280ms both' }}
        >
          Press{' '}
          <kbd class="px-1.5 py-0.5 rounded bg-hover/50 font-mono text-xs">
            ?
          </kbd>{' '}
          at any time to see all available keyboard shortcuts.
        </li>
      </ul>
    </div>
  );
}

export const whatsNextLesson: LessonDefinition = {
  id: 'whats-next',
  title: "What's next",
  description: 'A few tips before you dive in.',
  content: WhatsNextContent,
  order: 10,
};
