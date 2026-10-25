import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { getWebOrigin } from '@core/util/webOrigin';
import LinkIcon from '@phosphor/link.svg';
import {
  useCreateTeamInviteLinkMutation,
  useDeleteTeamInviteLinkMutation,
  useTeamInviteLinkQuery,
} from '@queries/team/invite-link';
import { Button, ConfirmDialog } from '@ui';
import { createSignal, Show } from 'solid-js';

/** The page a team invite link opens; see `TeamInviteLinkAcceptance`. */
export function teamInviteLinkUrl(token: string) {
  return `${getWebOrigin()}/app/team-invite?link=${encodeURIComponent(token)}`;
}

async function copyTeamInviteLink(token: string) {
  if (await writeClipboardData({ 'text/plain': teamInviteLinkUrl(token) })) {
    toast.success('Invite link copied');
  } else {
    toast.failure('Could not copy invite link');
  }
}

/**
 * The team's shareable invite link: anyone who opens it can join the team.
 * Anyone who may invite can copy it or create the first one; admins can
 * reset it or turn it off, which breaks links already shared.
 */
export function TeamInviteLinkSection(props: {
  teamId: string;
  canManage: boolean;
}) {
  const linkQuery = useTeamInviteLinkQuery(
    () => props.teamId,
    () => true
  );
  const createLink = useCreateTeamInviteLinkMutation({
    onSuccess: (token) => copyTeamInviteLink(token),
  });
  const deleteLink = useDeleteTeamInviteLinkMutation();
  const [confirming, setConfirming] = createSignal<'reset' | 'off'>();

  // Keep the cached link through a failed refetch. When it never loaded, the
  // link is unknown rather than missing: "Create link" would replace a link
  // people already share, so offer a retry instead.
  const link = () => (linkQuery.isPending ? undefined : linkQuery.data);
  const token = () => link()?.token ?? null;
  const unknown = () => !linkQuery.isPending && link() === undefined;
  const busy = () =>
    linkQuery.isPending || createLink.isPending || deleteLink.isPending;

  const handleCopyOrCreate = () => {
    const current = token();
    if (current) {
      fireAndForget(copyTeamInviteLink(current), 'team-invite-link');
    } else {
      createLink.mutate({ teamId: props.teamId });
    }
  };

  const handleConfirm = () => {
    if (confirming() === 'reset') {
      createLink.mutate({ teamId: props.teamId });
    } else {
      deleteLink.mutate({ teamId: props.teamId });
    }
    setConfirming(undefined);
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm text-ink">Invite link</div>
          <div class="text-xs text-ink-muted">
            <Show when={!unknown()} fallback="Couldn't load the invite link.">
              Anyone with the link can join your team. Paste it in Slack or an
              email.
            </Show>
          </div>
        </div>
        <Show
          when={!unknown()}
          fallback={
            <Button
              variant="outline"
              size="sm"
              class="shrink-0"
              onClick={() =>
                fireAndForget(linkQuery.refetch(), 'team-invite-link')
              }
            >
              Retry
            </Button>
          }
        >
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            disabled={busy()}
            onClick={handleCopyOrCreate}
          >
            <LinkIcon class="size-4" />
            <Show when={token()} fallback="Create link">
              Copy link
            </Show>
          </Button>
        </Show>
      </div>
      <Show when={props.canManage && token()}>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={busy()}
            onClick={() => setConfirming('reset')}
          >
            Reset link
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={busy()}
            onClick={() => setConfirming('off')}
          >
            Turn off
          </Button>
        </div>
      </Show>
      <ConfirmDialog
        open={!!confirming()}
        onOpenChange={(open) => !open && setConfirming(undefined)}
        title={
          confirming() === 'reset'
            ? 'Reset invite link'
            : 'Turn off invite link'
        }
        tone="danger"
        confirmLabel={confirming() === 'reset' ? 'Reset link' : 'Turn off'}
        onConfirm={handleConfirm}
        body={
          confirming() === 'reset'
            ? 'The current link stops working and a new one is copied. People who already joined stay on the team.'
            : 'The current link stops working. People who already joined stay on the team.'
        }
      />
    </div>
  );
}
