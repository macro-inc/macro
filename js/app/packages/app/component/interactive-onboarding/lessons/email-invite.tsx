import { createSignal, For } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function EmailInviteContent(_props: LessonContentProps) {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Macro is better with your team. Invite collaborators to your workspace
        by email.
      </p>
    </div>
  );
}

function EmailInviteDemo(props: LessonContentProps) {
  const [emails, setEmails] = createSignal(['']);

  const updateEmail = (index: number, value: string) => {
    setEmails((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const addField = () => {
    setEmails((prev) => [...prev, '']);
  };

  const handleSend = () => {
    props.onComplete();
  };

  return (
    <div class="h-full w-full flex items-center justify-center px-6">
      <div class="w-full max-w-sm flex flex-col gap-3">
        <p class="text-sm font-semibold text-ink/70">Invite teammates</p>
        <For each={emails()}>
          {(email, i) => (
            <input
              type="email"
              placeholder="name@company.com"
              value={email}
              onInput={(e) => updateEmail(i(), e.currentTarget.value)}
              class="w-full px-3 py-2 text-sm border border-edge-muted rounded-xs bg-panel text-ink placeholder:text-ink/30 outline-none focus:border-accent/50"
            />
          )}
        </For>
        <button
          type="button"
          class="self-start text-xs text-accent hover:text-accent/80"
          onClick={addField}
        >
          + Add another
        </button>
        <button
          type="button"
          class="w-full px-4 py-2 text-sm font-semibold bg-accent text-panel rounded-xs hover:bg-accent/90"
          onClick={handleSend}
        >
          Send Invites
        </button>
      </div>
    </div>
  );
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
