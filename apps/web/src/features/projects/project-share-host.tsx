import { ShareModal } from '@app/features/sharing/components/share-modal';
import { ShareTrigger } from '@app/features/sharing/components/share-trigger';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { getPermissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import {
  buildLinkSharePayload,
  buildLinkShareScopePayload,
  buildTeamSharePayload,
  getLinkShareScope,
  TEAM_SHARE_SCOPE_OPTIONS,
} from '@core/component/TopBar/linkShare';
import { useUserId } from '@core/context/user';
import StackIcon from '@phosphor/stack.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { useNavigate } from '@solidjs/router';
import { type ManagedDialogProps, useImperativeDialog } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { ProjectCollaborators } from './components/project-collaborators';
import type { ProjectDetail, ProjectSharingPatch } from './core/project';
import { createProjectChannelPreviewsSource } from './queries/project-channel-names';

export type ProjectShareHostProps = {
  project: ProjectDetail;
  url: string;
  pending: boolean;
  getUserName(id: string): string;
  onShare(patch: ProjectSharingPatch): Promise<void>;
  onMembers(ids: string[]): Promise<void>;
};

/** Native initiative adapter for the same Share menu used by tasks and documents. */
export function ProjectShareHost(props: ProjectShareHostProps) {
  const userId = useUserId();
  const team = useCurrentTeamQuery();
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const owner = () => props.project.access === 'owner';
  const pending = () => props.pending || saving();
  const grants = () => props.project.sharing.channelSharePermissions ?? [];
  const dialog = useImperativeDialog((managed: ManagedDialogProps) => (
    <Suspense>
      <ShareModal
        isSharePermOpen={managed.open}
        setIsSharePermOpen={(value) => {
          if (!pending()) managed.onOpenChange(value);
        }}
        itemType="initiative"
        icon={<StackIcon class="size-4 shrink-0" />}
        name={props.project.name}
        owner={props.project.ownerId}
        formattedOwner={
          props.project.ownerId === userId()
            ? 'Me'
            : props.getUserName(props.project.ownerId)
        }
        userPermissions={getPermissions(props.project.access)}
        canForward={owner()}
        forwardUnavailableDescription="Only the owner can share access to this project. You can copy a link for people who already have access."
        recipients={[...grants()]}
        channelNameMap={channelNames()}
        navigateToChannel={(id) => {
          navigate(`/channel/${id}`);
          managed.onOpenChange(false);
        }}
        removeChannelAccess={(channelId) =>
          change({
            channelSharePermissions: [{ channelId, operation: 'remove' }],
          })
        }
        setChannelPermissions={(id, level) => change(channelPatch(id, level))}
        linkShare={props.project.sharing.linkShare}
        linkShareAccessLevel={props.project.sharing.linkShareAccessLevel}
        setLinkShareScope={(scope) =>
          change(
            buildLinkShareScopePayload(
              getLinkShareScope(props.project.sharing.linkShare),
              scope,
              props.project.sharing.linkShareAccessLevel
            )
          )
        }
        setLinkShareAccessLevel={(level) => {
          const scope = getLinkShareScope(props.project.sharing.linkShare);
          if (level && scope !== 'NONE')
            change(buildLinkSharePayload(scope, level));
        }}
        teamShare={
          owner() && team.isSuccess && team.data
            ? {
                accessLevel: props.project.sharing.teamShareAccessLevel,
                setAccessLevel: (scope) => change(buildTeamSharePayload(scope)),
                itemNoun: 'project',
                scopeOptions: TEAM_SHARE_SCOPE_OPTIONS,
              }
            : undefined
        }
        copyLink={() => void copyLink()}
        hasCollaborators={props.project.memberIds.length > 0}
        people={
          <>
            <ProjectCollaborators
              project={props.project}
              getUserName={props.getUserName}
              pending={pending()}
              onMembers={(ids) => update(() => props.onMembers(ids))}
            />
            <Show when={error()}>
              {(message) => (
                <p role="alert" class="text-sm text-failure">
                  {message()}
                </p>
              )}
            </Show>
          </>
        }
        forward={(controls) => (
          <ForwardToChannel
            {...controls}
            name={props.project.name}
            entity={{
              entity_type: 'initiative',
              entity_id: props.project.id,
            }}
            initialAccessLevel="view"
            submitPermissionInfo={{
              userPermissions: getPermissions(props.project.access),
              channelSharePermissions: [...grants()],
              setChannelPermissions: () => {},
            }}
            prepareChannel={(id, level) => {
              if (!level)
                return Promise.reject(new Error('Choose an access level.'));
              return share(channelPatch(id, level));
            }}
          />
        )}
      />
    </Suspense>
  ));
  const channelNames = createProjectChannelPreviewsSource(() =>
    dialog.isOpen() ? grants().map((grant) => grant.channel_id) : []
  );

  const update = async (action: () => Promise<void>) => {
    if (!owner()) throw new Error('Only the project owner can change sharing.');
    if (pending()) throw new Error('A sharing update is already in progress.');
    setSaving(true);
    setError(undefined);
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not update sharing.'
      );
      throw error;
    } finally {
      setSaving(false);
    }
  };
  const share = (patch: ProjectSharingPatch) =>
    update(() => props.onShare(patch));
  const change = (patch: ProjectSharingPatch) => {
    void share(patch).catch(() => {});
  };
  const channelPatch = (
    channelId: string,
    level: AccessLevel
  ): ProjectSharingPatch => {
    if (level === 'owner')
      throw new Error('Project ownership cannot be granted to a channel.');
    return {
      channelSharePermissions: [
        {
          channelId,
          operation: grants().some((grant) => grant.channel_id === channelId)
            ? 'replace'
            : 'add',
          accessLevel: level,
        },
      ],
    };
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(props.url);
      analytics.track('copy_share_link', {
        entityType: 'initiative',
        entityId: props.project.id,
      });
      toast.success('Link copied to clipboard.');
    } catch {
      toast.failure('Could not copy the project link.');
    }
  };

  return (
    <ShareTrigger
      tooltip="Share project"
      open={() => {
        dialog.open({});
        analytics.track('share_menu_open', { blockType: 'initiative' });
      }}
      copyLink={() => void copyLink()}
    />
  );
}
