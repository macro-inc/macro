import CheckIcon from '@phosphor/check.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import type { TeamInvite } from '../context/onboarding-context';
import { ContinueButton, SkipButton } from './controls';

/** Already on a team — auto-joined by domain, or just created/joined here. */
export function OnTeamPanel(props: {
  name: string;
  finishing: boolean;
  onContinue: () => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-col items-center gap-2 py-4 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-success-bg text-success">
          <CheckIcon class="size-5" />
        </span>
        <p class="text-sm font-medium text-ink">You're on {props.name}</p>
        {/* Copy must stay true for auto-join, invite-accept, and the
            optimistic mid-create flash alike. */}
        <p class="max-w-xs text-xs text-ink-muted leading-snug">
          Your team is set up — everything your teammates bring into Macro is
          shared with you.
        </p>
      </div>
      <ContinueButton
        label={props.finishing ? 'Opening your workspace…' : 'Continue'}
        disabled={props.finishing}
        onClick={props.onContinue}
      />
    </div>
  );
}

/** Pending team invites — join one and move on. */
export function InvitesPanel(props: {
  invites: readonly TeamInvite[];
  joining: boolean;
  onJoin: (inviteId: string) => void;
  onSkip: () => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <For each={props.invites}>
        {(invite) => (
          <div class="flex items-center gap-2.5 rounded-lg border border-edge bg-surface px-4 py-3 text-sm">
            <span class="min-w-0 truncate text-ink">
              {invite.invitedBy} invited you to their team
            </span>
            <Button
              variant="cta"
              size="sm"
              class="ml-auto shrink-0"
              disabled={props.joining}
              onClick={() => props.onJoin(invite.id)}
            >
              Join
            </Button>
          </div>
        )}
      </For>
      <SkipButton disabled={props.joining} onClick={props.onSkip} />
    </div>
  );
}

export function TeamStatus(props: { message: string }) {
  return (
    <p role="status" class="text-center text-sm text-ink-muted">
      {props.message}
    </p>
  );
}

export function TeamLoadError(props: { onRetry: () => void }) {
  return (
    <p role="alert" class="text-center text-sm text-ink-muted">
      Couldn't load your team.{' '}
      <button type="button" class="underline" onClick={props.onRetry}>
        Try again
      </button>
    </p>
  );
}
