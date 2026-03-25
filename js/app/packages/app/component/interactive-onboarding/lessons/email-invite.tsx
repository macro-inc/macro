import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { MockAppChrome } from '../components/MockAppChrome';
import { useReferralCode } from '@core/context/user';
import { getWebOrigin } from '@core/util/webOrigin';
import { authServiceClient } from '@service-auth/client';

function parseEmails(raw: string): string[] {
  return raw
    .split(/[,\n\s]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

function EmailInviteContent(props: LessonContentProps) {
  const [value, setValue] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const referralCode = useReferralCode();
  let textareaRef: HTMLTextAreaElement | undefined;

  const referralUrl = () => {
    const code = referralCode();
    if (!code) return undefined;
    return `${getWebOrigin()}/app/signup?referral_code=${code}`;
  };

  const handleCopy = () => {
    const url = referralUrl();
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
      authServiceClient.sendReferralInvite(email);
    }
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
      <Show when={referralUrl()}>
        {(url) => (
          <div class="flex flex-col gap-1.5 pt-2 border-t border-edge-muted">
            <p class="text-xs text-ink/50">
              Or share your personal referral link:
            </p>
            <div class="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={url()}
                class="flex-1 px-3 py-1.5 text-xs border border-edge-muted rounded-xs bg-surface-secondary text-ink/70 outline-none select-all"
                onClick={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                class="px-3 py-1.5 text-xs font-medium rounded-xs border border-edge-muted bg-panel text-ink hover:bg-hover/60 transition-colors whitespace-nowrap"
              >
                {copied() ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </Show>
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
