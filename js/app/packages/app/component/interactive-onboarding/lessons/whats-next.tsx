import { onMount } from 'solid-js';
import { HotkeyCallout } from '../components-lib';
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
      <ul class="flex flex-col gap-3 text-sm text-ink/70">
        <li
          style={{ animation: 'onboarding-fade-up 300ms ease-out 120ms both' }}
        >
          <HotkeyCallout
            size="sm"
            keys={['Enter']}
            label="to open the focused item"
          />
        </li>
        <li
          style={{ animation: 'onboarding-fade-up 300ms ease-out 200ms both' }}
        >
          <HotkeyCallout
            size="sm"
            keys={['⌘', 'K']}
            label="to open the command menu"
          />
        </li>
        <li
          style={{ animation: 'onboarding-fade-up 300ms ease-out 280ms both' }}
        >
          <HotkeyCallout
            size="sm"
            keys={['?']}
            label="to see all keyboard shortcuts"
          />
        </li>
      </ul>
    </div>
  );
}

export const whatsNextLesson: LessonDefinition = {
  id: 'whats-next',
  title: "What's next",
  subtitle: 'A few tips before you dive in.',
  content: WhatsNextContent,
  order: 10,
};
