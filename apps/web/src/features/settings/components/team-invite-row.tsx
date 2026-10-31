import { getWebOrigin } from '@core/util/webOrigin';
import { formatRelativeTimestamp } from '@entity';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import LinkIcon from '@phosphor/link.svg';
import PaperPlaneTiltIcon from '@phosphor/paper-plane-tilt.svg';
import XIcon from '@phosphor/x.svg';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import { Button, Tooltip } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { canResendInvite } from '../teamInviteResend';

/** A pending team invite with its resend, copy-link, and cancel actions. */
export function TeamInviteRow(props: {
  invite: TeamInviteDetails;
  canChange: boolean;
  resending: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  const canResend = () =>
    canResendInvite(props.invite.last_sent_at, new Date());
  const [copied, setCopied] = createSignal(false);
  let copyResetTimeout: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copyResetTimeout));
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${getWebOrigin()}/app/team-invite?id=${props.invite.id}`
      );
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
      return;
    }
    setCopied(true);
    clearTimeout(copyResetTimeout);
    copyResetTimeout = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="flex items-center justify-between gap-2 px-4 py-4">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="size-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
          <EnvelopeIcon class="size-4 text-accent" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-ink truncate">{props.invite.email}</div>
          <div class="text-xs text-ink-muted">
            Invited as {props.invite.team_role} · sent{' '}
            {formatRelativeTimestamp(props.invite.last_sent_at, {
              condensed: true,
            })}
          </div>
        </div>
      </div>
      <Show when={props.canChange}>
        <Tooltip
          label={
            canResend()
              ? 'Resend invite'
              : 'You can resend an hour after the last email'
          }
        >
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0"
            aria-label="Resend invite"
            disabled={!canResend() || props.resending}
            onClick={props.onResend}
          >
            <PaperPlaneTiltIcon class="size-4" />
          </Button>
        </Tooltip>
        <Tooltip label={copied() ? 'Copied' : 'Copy invite link'}>
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0"
            aria-label="Copy invite link"
            onClick={handleCopyLink}
          >
            <Show when={copied()} fallback={<LinkIcon class="size-4" />}>
              <CheckIcon class="size-4" />
            </Show>
          </Button>
        </Tooltip>
        <Tooltip label="Cancel invite">
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0"
            aria-label="Cancel invite"
            onClick={props.onCancel}
          >
            <XIcon class="size-4" />
          </Button>
        </Tooltip>
      </Show>
    </div>
  );
}
