import { createSignal, onCleanup, onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { MockAppChrome } from '../components/MockAppChrome';
import { authServiceClient } from '@service-auth/client';
import { contactsClient } from '@service-contacts/client';
import { isOk } from '@core/util/maybeResult';

function parseEmails(raw: string): string[] {
  return raw
    .split(/[,\n\s]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

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
    const emails = parseEmails(value());
    if (!emails.length) return;
    for (const email of emails) {
      authServiceClient.sendReferralInvite(email).then((result) => {
        if (isOk(result)) {
          contactsClient.addContact(`macro|${email.toLowerCase()}`);
        }
      });
    }
  });

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Invite friends and teammates to Macro. You'll get $100 in credits for
        each person who signs up.
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
  content: EmailInviteContent,
  demo: EmailInviteDemo,
  order: 70,
  skippable: true,
};
