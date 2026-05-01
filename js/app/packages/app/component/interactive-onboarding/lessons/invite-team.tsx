import {
  createEffect,
  createMemo,
  createSignal,
  Index,
  on,
  Show,
} from 'solid-js';
import { Tooltip } from '@core/component/Tooltip';
import { z } from 'zod';
import { cn } from '@ui/utils/classname';
import PlusIcon from '@icon/regular/plus.svg';
import XIcon from '@icon/regular/x.svg';
import TrashIcon from '@icon/regular/trash-simple.svg';
import {
  invalidateUserTeams,
  useCreateTeamWithInvitesMutation,
} from '@queries/team';
import { useEmail } from '@core/context/user';
import type { LessonContentProps, LessonDefinition } from '../types';

const inviteFormSchema = z.object({
  teamName: z
    .string()
    .min(1, 'Team name is required')
    .max(50, 'Team name is too long'),
  emails: z
    .array(z.string())
    .transform((emails) => emails.filter((e) => e.trim() !== ''))
    .pipe(z.array(z.string().email('Invalid email address'))),
});

const INVITE_FORM_ID = 'invite-team-form';
const TEAM_NAME_MAX_LENGTH = 50;

function InviteTeamContent() {
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

  const createTeamMutation = useCreateTeamWithInvitesMutation({
    onSettled: () => invalidateUserTeams(),
  });
  const userEmail = useEmail();

  const emailPlaceholder = createMemo(() => {
    const email = userEmail();
    if (!email) return 'colleague@company.com';
    const domain = email.split('@')[1];
    return domain ? `colleague@${domain}` : 'colleague@company.com';
  });

  const isValid = () => teamName().trim().length > 0;
  const isPending = () => createTeamMutation.isPending;

  const charCountColor = () => {
    const len = teamName().length;
    if (len > TEAM_NAME_MAX_LENGTH) return 'text-failure-ink';
    if (len > TEAM_NAME_MAX_LENGTH - 10) return 'text-alert-ink';
    return 'text-ink/40';
  };

  createEffect(
    on(
      () => [isValid(), isPending()] as const,
      ([valid, pending]) => {
        props.onComplete(pending ? 'Creating...' : 'Create team', {
          skipFocus: true,
        });
        if (!valid || pending) {
          props.onUnready();
        }
      },
      { defer: false }
    )
  );

  const canAddEmail = () => {
    const currentEmails = emails();
    if (currentEmails.length === 0) {
      return true;
    }
    const lastEmail = currentEmails[currentEmails.length - 1];
    return lastEmail?.trim() !== '';
  };

  const addEmailField = () => {
    if (!canAddEmail() || isPending()) return;
    const newIndex = emails().length;
    setEmails((prev) => [...prev, '']);
    requestAnimationFrame(() => {
      const input = document.getElementById(`invite-email-${newIndex}`);
      input?.focus();
    });
  };

  const updateEmail = (index: number, value: string) => {
    setEmails((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (errors().emails?.[index]) {
      setErrors((prev) => {
        const emailErrors = { ...prev.emails };
        delete emailErrors[index];
        return { ...prev, emails: emailErrors };
      });
    }
  };

  const updateTeamName = (value: string) => {
    setTeamName(value);
    if (errors().teamName) {
      setErrors((prev) => ({ ...prev, teamName: undefined }));
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

  const validateField = (
    field: 'teamName' | 'email',
    index: number,
    value: string
  ) => {
    if (field === 'teamName') {
      const result = z
        .string()
        .min(1, 'Team name is required')
        .max(50, 'Team name is too long')
        .safeParse(value);
      setErrors((prev) => ({
        ...prev,
        teamName: result.success ? undefined : result.error.issues[0]?.message,
      }));
    } else if (field === 'email' && value.trim() !== '') {
      const result = z.string().email('Invalid email address').safeParse(value);
      setErrors((prev) => ({
        ...prev,
        emails: {
          ...prev.emails,
          [index]: result.success ? undefined : result.error.issues[0]?.message,
        },
      }));
    }
  };

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (isPending()) return;

    const result = inviteFormSchema.safeParse({
      teamName: teamName(),
      emails: emails(),
    });

    if (!result.success) {
      const newErrors: FormErrors = {};
      for (const error of result.error.issues) {
        if (error.path[0] === 'teamName') {
          newErrors.teamName = error.message;
        } else if (
          error.path[0] === 'emails' &&
          typeof error.path[1] === 'number'
        ) {
          newErrors.emails = newErrors.emails || {};
          newErrors.emails[error.path[1]] = error.message;
        }
      }
      setErrors(newErrors);
      return;
    }

    setErrors({});

    try {
      await createTeamMutation.mutateAsync({
        name: result.data.teamName,
        emails: result.data.emails.length > 0 ? result.data.emails : undefined,
      });
      props.advance();
    } catch {
      // Error is displayed in the form via createTeamMutation.error
    }
  };

  return (
    <div class="h-full w-full flex items-start justify-start p-12 overflow-hidden">
      <form
        id={INVITE_FORM_ID}
        onSubmit={handleSubmit}
        class="w-full max-w-lg flex flex-col gap-8 h-full"
      >
        <div class="flex flex-col gap-2 shrink-0 px-2">
          <label class="text-base font-medium text-ink" for="team-name">
            Team name
          </label>
          <input
            id="team-name"
            type="text"
            value={teamName()}
            onInput={(e) => updateTeamName(e.currentTarget.value)}
            onBlur={() => validateField('teamName', 0, teamName())}
            placeholder="Enter your team name"
            disabled={isPending()}
            aria-describedby="team-name-counter"
            class={cn(
              'w-[calc(100%-36px)] px-3 py-2 text-base rounded-xs border bg-panel text-ink placeholder:text-ink/40 bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-panel',
              errors().teamName
                ? 'border-failure focus-visible:ring-failure'
                : 'border-edge focus-visible:ring-accent',
              isPending() && 'opacity-50 cursor-not-allowed'
            )}
          />
          <div class="flex justify-between items-center w-[calc(100%-36px)]">
            <Show when={errors().teamName}>
              <p class="text-sm text-failure-ink" role="alert">
                {errors().teamName}
              </p>
            </Show>
            <p
              id="team-name-counter"
              class={cn('text-sm ml-auto', charCountColor())}
            >
              {teamName().length}/{TEAM_NAME_MAX_LENGTH}
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-2 min-h-0 flex-1">
          <div class="flex flex-col min-h-0">
            <div class="shrink-0 px-2">
              <label
                class="text-base font-medium text-ink"
                id="invite-members-label"
              >
                Invite members{' '}
                <span class="font-normal text-ink/50">(optional)</span>
              </label>
              <p class="text-sm text-ink/50" id="invite-members-description">
                We'll send them an invite to join your workspace
              </p>
            </div>
            <div class="flex flex-col gap-3 overflow-y-auto min-h-0 p-2">
              <Index each={emails()}>
                {(email, index) => (
                  <div class="flex flex-col gap-1 shrink-0">
                    <div class="flex items-center gap-2">
                      <input
                        id={`invite-email-${index}`}
                        type="email"
                        value={email()}
                        onInput={(e) =>
                          updateEmail(index, e.currentTarget.value)
                        }
                        onBlur={(e) =>
                          validateField('email', index, e.currentTarget.value)
                        }
                        placeholder={emailPlaceholder()}
                        disabled={isPending()}
                        aria-labelledby="invite-members-label"
                        aria-describedby="invite-members-description"
                        aria-invalid={!!errors().emails?.[index]}
                        class={cn(
                          'flex-1 px-3 py-2 text-base rounded-xs border bg-panel text-ink placeholder:text-ink/40 bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-panel',
                          errors().emails?.[index]
                            ? 'border-failure focus-visible:ring-failure'
                            : 'border-edge focus-visible:ring-accent',
                          isPending() && 'opacity-50 cursor-not-allowed'
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
                          disabled={isPending()}
                          aria-label={
                            emails().length > 1
                              ? `Remove email ${index + 1}`
                              : 'Clear email'
                          }
                          class={cn(
                            'shrink-0 p-1.5 text-ink/40 hover:text-ink hover:bg-ink/5 rounded-xs bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel',
                            isPending() && 'opacity-50 cursor-not-allowed'
                          )}
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
                      <p class="text-sm text-failure-ink" role="alert">
                        {errors().emails?.[index]}
                      </p>
                    </Show>
                  </div>
                )}
              </Index>
            </div>
          </div>
          <div class="flex items-center gap-2 px-2">
            <button
              type="button"
              onClick={addEmailField}
              disabled={!canAddEmail() || isPending()}
              aria-label="Add another email invite"
              class={cn(
                'flex-1 flex items-center gap-2 px-3 py-2 text-sm rounded-xs bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel shrink-0',
                canAddEmail() && !isPending()
                  ? 'text-ink bg-ink/8 hover:bg-ink/12'
                  : 'text-ink/30 bg-ink/4 cursor-not-allowed'
              )}
            >
              <PlusIcon class="size-4" />
              Add another
            </button>
            <div class="shrink-0 w-7" />
          </div>
          <p class="text-sm text-ink/40 shrink-0 px-2">
            You can always invite more people later from Settings
          </p>
        </div>

        <Show when={createTeamMutation.error}>
          <p class="text-sm text-failure-ink px-2" role="alert">
            {createTeamMutation.error?.message ?? 'Failed to create team'}
          </p>
        </Show>
      </form>
    </div>
  );
}

function SkipAction(props: LessonContentProps) {
  return (
    <button
      type="button"
      onClick={() => props.advance()}
      class="w-full px-3 py-2.5 text-lg rounded-xs flex items-center justify-between text-ink/40 hover:text-ink hover:bg-ink/5 bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel"
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
    const form = document.getElementById(
      INVITE_FORM_ID
    ) as HTMLFormElement | null;
    form?.requestSubmit();
  },
};
