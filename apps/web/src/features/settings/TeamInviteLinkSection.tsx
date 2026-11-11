import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { getWebOrigin } from '@core/util/webOrigin';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import GearIcon from '@icon/system/regular/gear.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PowerIcon from '@icon/system/regular/power.svg';
import {
  useCreateTeamInviteLinkMutation,
  useDeleteTeamInviteLinkMutation,
  useTeamInviteLinkQuery,
} from '@queries/team/invite-link';
import { Button, ConfirmDialog, Dropdown } from '@ui';
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
 * Copies the team's invite link, creating the first one when the team has
 * none. While the link is unknown (it never loaded) the button stays disabled:
 * creating one would replace a link people already share.
 */
export function CopyTeamInviteLinkButton(props: {
  teamId: string;
  class?: string;
}) {
  const linkQuery = useTeamInviteLinkQuery(
    () => props.teamId,
    () => true
  );
  const createLink = useCreateTeamInviteLinkMutation({
    onSuccess: (token) => copyTeamInviteLink(token),
  });
  const token = () =>
    linkQuery.isPending ? undefined : (linkQuery.data?.token ?? null);
  const unknown = () => !linkQuery.isPending && linkQuery.data === undefined;
  const handleCopy = () => {
    const current = token();
    if (current) {
      fireAndForget(copyTeamInviteLink(current), 'team-invite-link');
    } else if (current === null && !unknown()) {
      createLink.mutate({ teamId: props.teamId });
    }
  };
  return (
    <Button
      variant="secondary"
      class={props.class}
      disabled={linkQuery.isPending || createLink.isPending || unknown()}
      onClick={handleCopy}
    >
      <LinkIcon class="size-4" />
      Copy invite link
    </Button>
  );
}

/**
 * The team's shareable invite link: anyone who opens it can join the team.
 * Anyone who may invite can copy it or create the first one; admins can
 * reset it or turn it off from the settings menu beside it, which breaks
 * links already shared.
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
    <>
      <div class="flex items-center justify-between gap-4">
        <div class="flex min-w-0 flex-col gap-1">
          <div class="text-sm font-medium text-ink">Invite link</div>
          <div class="text-sm text-ink-muted">
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
              variant="secondary"
              class="shrink-0"
              onClick={() =>
                fireAndForget(linkQuery.refetch(), 'team-invite-link')
              }
            >
              Retry
            </Button>
          }
        >
          <div class="flex shrink-0 items-center gap-1">
            <Show when={props.canManage && token()}>
              <Dropdown>
                <Dropdown.Trigger
                  aria-label="Invite link settings"
                  variant="ghost"
                  size="icon-md"
                  disabled={busy()}
                >
                  <GearIcon class="size-4" />
                </Dropdown.Trigger>
                <Dropdown.Content class="min-w-40">
                  <Dropdown.Group>
                    <Dropdown.Item onSelect={() => setConfirming('reset')}>
                      <ArrowsClockwiseIcon class="size-4" />
                      Reset link
                    </Dropdown.Item>
                    <Dropdown.Item
                      class="text-failure data-highlighted:bg-failure-bg"
                      onSelect={() => setConfirming('off')}
                    >
                      <PowerIcon class="size-4" />
                      Turn off
                    </Dropdown.Item>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </Show>
            <Button
              variant="primary"
              disabled={busy()}
              onClick={handleCopyOrCreate}
            >
              <Show when={token()} fallback="Create link">
                Copy link
              </Show>
            </Button>
          </div>
        </Show>
      </div>
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
    </>
  );
}
