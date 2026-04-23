import { createEffect, createSignal, Index, on, Show } from 'solid-js';
import { Tooltip } from '@core/component/Tooltip';
import { z } from 'zod';
import { cn } from '@ui/utils/classname';
import PlusIcon from '@icon/regular/plus.svg';
import XIcon from '@icon/regular/x.svg';
import TrashIcon from '@icon/regular/trash-simple.svg';
import type { LessonContentProps, LessonDefinition } from '../types';

const inviteFormSchema = z.object({
  teamName: z.string().min(1, 'Team name is required').max(50, 'Team name is too long'),
  emails: z.array(z.string()).transform((emails) => emails.filter((e) => e.trim() !== '')).pipe(
    z.array(z.string().email('Invalid email address'))
  ),
});

const INVITE_FORM_ID = 'invite-team-form';

function InviteTeamContent(props: LessonContentProps) {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Create your team and invite collaborators to get started together.</p>
    </div>
  );
}

type FormErrors = {
  teamName?: string;
  emails?: Record<number, string | undefined>;
};

function InviteTeamDemo(props: LessonContentProps) {
  const [teamName, setTeamName] = createSignal('');
  const [emails, setEmails] = createSignal<string[]>(['']);
  const [errors, setErrors] = createSignal<FormErrors>({});
  const [submitted, setSubmitted] = createSignal(false);

  const isValid = () => teamName().trim().length > 0;

  createEffect(
    on(isValid, (valid) => {
      props.onComplete('Create team', { skipFocus: true });
      if (!valid) {
        props.onUnready();
      }
    }, { defer: false })
  );

  const canAddEmail = () => {
    const currentEmails = emails();
    const lastEmail = currentEmails[currentEmails.length - 1];
    return lastEmail?.trim() !== '';
  };

  const addEmailField = () => {
    if (!canAddEmail()) return;
    setEmails((prev) => [...prev, '']);
  };

  const updateEmail = (index: number, value: string) => {
    setEmails((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (value.trim() === '') {
      setErrors((prev) => {
        const emailErrors = { ...prev.emails };
        delete emailErrors[index];
        return { ...prev, emails: emailErrors };
      });
    } else if (submitted()) {
      validateField('email', index, value);
    }
  };

  const updateTeamName = (value: string) => {
    setTeamName(value);
    if (submitted()) {
      validateField('teamName', 0, value);
    }
  };

  const removeEmail = (index: number) => {
    setEmails((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const emailErrors = { ...prev.emails };
      delete emailErrors[index];
      return { ...prev, emails: emailErrors };
    });
  };

  const validateField = (field: 'teamName' | 'email', index: number, value: string) => {
    if (field === 'teamName') {
      const result = z.string().min(1, 'Team name is required').max(50, 'Team name is too long').safeParse(value);
      setErrors((prev) => ({
        ...prev,
        teamName: result.success ? undefined : result.error.errors[0]?.message,
      }));
    } else if (field === 'email' && value.trim() !== '') {
      const result = z.string().email('Invalid email address').safeParse(value);
      setErrors((prev) => ({
        ...prev,
        emails: {
          ...prev.emails,
          [index]: result.success ? undefined : result.error.errors[0]?.message,
        },
      }));
    }
  };

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    setSubmitted(true);

    const result = inviteFormSchema.safeParse({
      teamName: teamName(),
      emails: emails(),
    });

    if (!result.success) {
      const newErrors: FormErrors = {};
      for (const error of result.error.errors) {
        if (error.path[0] === 'teamName') {
          newErrors.teamName = error.message;
        } else if (error.path[0] === 'emails' && typeof error.path[1] === 'number') {
          newErrors.emails = newErrors.emails || {};
          newErrors.emails[error.path[1]] = error.message;
        }
      }
      setErrors(newErrors);
      return;
    }

    setErrors({});
    console.log('Form submitted:', result.data);
    props.advance();
  };

  return (
    <div class="h-full w-full flex items-start justify-start p-12 overflow-hidden">
      <form id={INVITE_FORM_ID} onSubmit={handleSubmit} class="w-full max-w-lg flex flex-col gap-8 h-full">
        <div class="flex flex-col gap-2 shrink-0 px-2">
          <label class="text-base font-medium text-ink" for="team-name">
            Team name
          </label>
          <input
            id="team-name"
            type="text"
            value={teamName()}
            onInput={(e) => updateTeamName(e.currentTarget.value)}
            placeholder="Enter your team name"
            class={cn(
              'w-full px-3 py-2 text-base rounded-xs border bg-panel text-ink placeholder:text-ink/40 bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-panel',
              errors().teamName
                ? 'border-failure focus-visible:ring-failure'
                : 'border-edge focus-visible:ring-accent'
            )}
          />
          <Show when={errors().teamName}>
            <p class="text-sm text-failure-ink">{errors().teamName}</p>
          </Show>
        </div>

        <div class="flex flex-col gap-2 min-h-0 flex-1">
          <div class="flex flex-col min-h-0">
            <div class="shrink-0 px-2">
              <label class="text-base font-medium text-ink">
                Invite members
              </label>
              <p class="text-sm text-ink/50">
                We'll send them an invite to join your workspace
              </p>
            </div>
            <div class="flex flex-col gap-3 overflow-y-auto min-h-0 p-2">
              <Index each={emails()}>
                {(email, index) => (
                  <div class="flex flex-col gap-1 shrink-0">
                    <div class="flex items-center gap-2">
                      <input
                        type="email"
                        value={email()}
                        onInput={(e) => updateEmail(index, e.currentTarget.value)}
                        placeholder="colleague@company.com"
                        class={cn(
                          'w-full px-3 py-2 text-base rounded-xs border bg-panel text-ink placeholder:text-ink/40 bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-panel',
                          errors().emails?.[index]
                            ? 'border-failure focus-visible:ring-failure'
                            : 'border-edge focus-visible:ring-accent'
                        )}
                      />
                      <Tooltip
                        tooltip={emails().length > 1 ? 'Remove' : 'Clear'}
                        placement="top"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            emails().length === 1
                              ? updateEmail(0, '')
                              : removeEmail(index)
                          }
                          class="p-1.5 text-ink/40 hover:text-ink hover:bg-ink/5 rounded-xs bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel shrink-0"
                        >
                          <Show
                            when={emails().length > 1}
                            fallback={<XIcon class="size-4" />}
                          >
                            <TrashIcon class="size-4" />
                          </Show>
                        </button>
                      </Tooltip>
                    </div>
                    <Show when={errors().emails?.[index]}>
                      <p class="text-sm text-failure-ink">{errors().emails?.[index]}</p>
                    </Show>
                  </div>
                )}
              </Index>
            </div>
          </div>
          <button
            type="button"
            onClick={addEmailField}
            disabled={!canAddEmail()}
            class={cn(
              'flex items-center gap-2 px-3 py-2 text-sm rounded-xs w-full bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel shrink-0 mx-2',
              canAddEmail()
                ? 'text-ink bg-ink/8 hover:bg-ink/12'
                : 'text-ink/30 bg-ink/4 cursor-not-allowed'
            )}
          >
            <PlusIcon class="size-4" />
            Add another
          </button>
          <p class="text-sm text-ink/40 shrink-0 px-2">
            You can always invite more people later from Settings
          </p>
        </div>
      </form>
    </div>
  );
}


function SkipAction() {
  return (
    <button
      type="button"
      class="w-full px-3 py-2.5 text-lg rounded-xs flex items-center justify-between text-ink/60 hover:text-ink hover:bg-ink/5 bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel"
    >
      Skip for now
    </button>
  );
}

export const inviteTeamLesson: LessonDefinition = {
  id: 'invite-team',
  title: 'Set up your team',
  content: InviteTeamContent,
  demo: InviteTeamDemo,
  order: 90,
  secondaryAction: SkipAction,
  onContinue: () => {
    const form = document.getElementById(INVITE_FORM_ID) as HTMLFormElement | null;
    form?.requestSubmit();
  },
};
