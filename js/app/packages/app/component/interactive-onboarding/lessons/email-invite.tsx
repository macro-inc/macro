import { createSignal, onCleanup, onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { MockAppChrome } from '../components/MockAppChrome';

function EmailInviteContent(props: LessonContentProps) {
  const [value, setValue] = createSignal('');
  let textareaRef: HTMLTextAreaElement | undefined;

  // setTimeout defers onComplete to a new macrotask, safely after the shell's
  // handleContinue has finished calling setReadyToContinue(false). Then the
  // double-rAF focuses the textarea after the shell's own rAF focuses the button.
  onMount(() => {
    setTimeout(() => {
      props.onComplete('Send Invites');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => textareaRef?.focus())
      );
    });
  });

  onCleanup(() => {
    const emails = value().trim();
    if (!emails) return;
    // TODO: fire invite API here in next PR (fire-and-forget)
  });

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Macro is better with your team. Invite collaborators to your workspace
        by email.
      </p>
      <div class="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          placeholder={'name@company.com\ncolleague@company.com'}
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          rows={4}
          class="w-full px-3 py-2 text-sm border border-edge-muted rounded-xs bg-panel text-ink placeholder:text-ink/30 outline-none focus:border-accent/50 resize-none leading-relaxed"
        />
        <p class="text-xs text-ink/40">
          Separate addresses with a new line or comma.
        </p>
      </div>
    </div>
  );
}

function EmailInviteDemo() {
  return <MockAppChrome />;
}

export const emailInviteLesson: LessonDefinition = {
  id: 'email-invite',
  title: 'Invite Your Team',
  subtitle: 'Bring your teammates into Macro.',
  content: EmailInviteContent,
  demo: EmailInviteDemo,
  order: 70,
  skippable: true,
};
