import type { PaidPlanTier } from '@app/component/paywall/plans';
import { TierSelect } from '@app/component/teams/TierSelect';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { ENABLE_TEAM_INVITE_TIERS_OVERRIDE } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import CheckIcon from '@icon/check.svg';
import PlusIcon from '@icon/plus.svg';
import TrashIcon from '@icon/trash-simple.svg';
import XIcon from '@icon/x.svg';
import { cn, Tooltip } from '@ui';
import { createMemo, createSignal, Index, onMount, Show } from 'solid-js';
import { z } from 'zod';
import { useOnboarding } from '../onboarding-context';
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
      <p>Your team gets:</p>
      <div class="flex flex-col gap-2">
        <div class="flex items-start gap-2">
          <CheckIcon class="size-4 text-accent shrink-0 mt-0.5" />
          <span class="text-sm text-ink/70">
            Shared calls and tasks across your team
          </span>
        </div>
        <div class="flex items-start gap-2">
          <CheckIcon class="size-4 text-accent shrink-0 mt-0.5" />
          <span class="text-sm text-ink/70">Unified team AI memory</span>
        </div>
        <div class="flex items-start gap-2">
          <CheckIcon class="size-4 text-accent shrink-0 mt-0.5" />
          <span class="text-sm text-ink/70">Add or remove members anytime</span>
        </div>
      </div>
    </div>
  );
}

type FormErrors = {
  teamName?: string;
  emails?: Record<number, string | undefined>;
};

type InviteEntry = { email: string; tier: PaidPlanTier };

function InviteTeamDemo(props: LessonContentProps) {
  const onboarding = useOnboarding();
  const tierFlag = useFeatureFlag('enable-team-invite-tiers', {
    enabledOverride: ENABLE_TEAM_INVITE_TIERS_OVERRIDE,
  });
  const showTier = () => tierFlag().enabled;

  const initialEntries = (): InviteEntry[] => {
    const members = onboarding.invitedMembers();
    if (members.length > 0) {
      return members
        .filter((m) => m.tier !== 'free')
        .map((m) => ({ email: m.email, tier: m.tier as PaidPlanTier }));
    }
    return [{ email: '', tier: 'haiku' }];
  };

  const [teamName, setTeamName] = createSignal(onboarding.teamName());
  const [inviteEntries, setInviteEntries] = createSignal<InviteEntry[]>(
    initialEntries()
  );
  const [errors, setErrors] = createSignal<FormErrors>({});

  const emails = () => inviteEntries().map((e) => e.email);

  const syncInvitedMembers = (entries: InviteEntry[]) => {
    const validMembers = entries
      .filter(
        (e) =>
          e.email.trim() !== '' && z.string().email().safeParse(e.email).success
      )
      .map((entry) => ({ email: entry.email, tier: entry.tier }));
    onboarding.setInvitedMembers(validMembers);
  };

  const userEmail = useEmail();

  const emailPlaceholder = createMemo(() => {
    const email = userEmail();
    if (!email) return 'colleague@company.com';
    const domain = email.split('@')[1];
    return domain ? `colleague@${domain}` : 'colleague@company.com';
  });

  const isValid = () => {
    const trimmed = teamName().trim();
    return trimmed.length >= 1 && trimmed.length <= TEAM_NAME_MAX_LENGTH;
  };

  const charCountColor = () => {
    const len = teamName().length;
    if (len > TEAM_NAME_MAX_LENGTH) return 'text-failure-ink';
    if (len > TEAM_NAME_MAX_LENGTH - 10) return 'text-alert-ink';
    return 'text-ink/40';
  };

  const updateReadyState = () => {
    if (isValid()) {
      props.onComplete('Continue', { skipFocus: true });
    } else {
      props.onUnready();
    }
  };

  onMount(() => {
    queueMicrotask(updateReadyState);
  });

  const canAddEmail = () => {
    const entries = inviteEntries();
    if (entries.length === 0) {
      return true;
    }
    const lastEntry = entries[entries.length - 1];
    return lastEntry?.email.trim() !== '';
  };

  const addEmailField = () => {
    if (!canAddEmail()) return;
    const newIndex = inviteEntries().length;
    setInviteEntries((prev) => [...prev, { email: '', tier: 'haiku' }]);
    requestAnimationFrame(() => {
      const input = document.getElementById(`invite-email-${newIndex}`);
      input?.focus();
    });
  };

  const updateEmail = (index: number, value: string) => {
    const next = [...inviteEntries()];
    next[index] = { ...next[index], email: value };
    setInviteEntries(next);
    syncInvitedMembers(next);
    if (errors().emails?.[index]) {
      setErrors((prev) => {
        const emailErrors = { ...prev.emails };
        delete emailErrors[index];
        return { ...prev, emails: emailErrors };
      });
    }
  };

  const updateTier = (index: number, tier: PaidPlanTier) => {
    const next = [...inviteEntries()];
    next[index] = { ...next[index], tier };
    setInviteEntries(next);
    syncInvitedMembers(next);
  };

  const updateTeamName = (value: string) => {
    setTeamName(value);
    onboarding.setTeamName(value);
    if (errors().teamName) {
      setErrors((prev) => ({ ...prev, teamName: undefined }));
    }
    const trimmed = value.trim();
    if (trimmed.length >= 1 && trimmed.length <= TEAM_NAME_MAX_LENGTH) {
      props.onComplete('Continue', { skipFocus: true });
    } else {
      props.onUnready();
    }
  };

  const removeEmail = (index: number) => {
    const next = inviteEntries().filter((_, i) => i !== index);
    setInviteEntries(next);
    syncInvitedMembers(next);
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

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault();

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
    props.advance();
  };

  return (
    <div class="size-full flex items-start justify-center p-12 pt-[12%] overflow-hidden">
      <form
        id={INVITE_FORM_ID}
        onSubmit={handleSubmit}
        class="w-full max-w-md flex flex-col gap-6"
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
            disabled={false}
            aria-describedby="team-name-counter"
            class={cn(
              'w-[calc(100%-36px)] px-3 py-2 text-base rounded-xs border bg-surface text-ink placeholder:text-ink/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
              errors().teamName
                ? 'border-failure focus-visible:ring-failure'
                : 'border-edge focus-visible:ring-accent',
              false
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

        <div class="flex flex-col gap-2 min-h-0 flex-1 overflow-hidden pb-4">
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
            <Index each={inviteEntries()}>
              {(entry, index) => (
                <div class="flex flex-col gap-1 shrink-0">
                  <div class="flex items-center gap-2">
                    <input
                      id={`invite-email-${index}`}
                      type="email"
                      value={entry().email}
                      onInput={(e) => updateEmail(index, e.currentTarget.value)}
                      onBlur={(e) =>
                        validateField('email', index, e.currentTarget.value)
                      }
                      placeholder={emailPlaceholder()}
                      disabled={false}
                      aria-labelledby="invite-members-label"
                      aria-describedby="invite-members-description"
                      aria-invalid={!!errors().emails?.[index]}
                      class={cn(
                        'flex-1 px-3 py-2 text-base rounded-xs border bg-surface text-ink placeholder:text-ink/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                        errors().emails?.[index]
                          ? 'border-failure focus-visible:ring-failure'
                          : 'border-edge focus-visible:ring-accent',
                        false
                      )}
                    />
                    <Show when={showTier()}>
                      <TierSelect
                        value={entry().tier}
                        onChange={(tier) => updateTier(index, tier)}
                        disabled={false}
                        triggerClass="flex items-center justify-between gap-1 w-28 px-3 py-2 text-base border border-edge rounded-xs bg-surface text-ink outline-none shrink-0 hover:bg-ink/5 data-[expanded]:bg-ink/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface [&>svg]:data-[expanded]:rotate-180 [&>svg]:transition-transform"
                      />
                    </Show>
                    <Tooltip
                      label={inviteEntries().length > 1 ? 'Remove' : 'Clear'}
                      placement="top"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          inviteEntries().length === 1
                            ? updateEmail(0, '')
                            : removeEmail(index)
                        }
                        disabled={false}
                        aria-label={
                          inviteEntries().length > 1
                            ? `Remove email ${index + 1}`
                            : 'Clear email'
                        }
                        class={cn(
                          'shrink-0 p-1.5 text-ink/40 hover:text-ink hover:bg-ink/5 rounded-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface'
                        )}
                      >
                        <Show
                          when={inviteEntries().length > 1}
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
          <button
            type="button"
            onClick={addEmailField}
            disabled={!canAddEmail()}
            aria-label="Add another email invite"
            class={cn(
              'mx-2 flex items-center gap-2 px-3 py-2 text-sm rounded-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface shrink-0',
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

export const inviteTeamLesson: LessonDefinition = {
  id: 'invite-team',
  title: 'Create your team',
  content: InviteTeamContent,
  demo: InviteTeamDemo,
  order: 90,
  completeOnParam: 'subscriptionSuccess',
  previousLesson: 'team-choice',
  onBack: ({ onboarding }) => {
    onboarding.setTeamName('');
    onboarding.setInvitedMembers([]);
  },
  onContinue: () => {
    const form = document.getElementById(
      INVITE_FORM_ID
    ) as HTMLFormElement | null;
    form?.requestSubmit();
  },
};
