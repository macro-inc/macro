import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { catchToResult } from '@core/util/result';
import type { ChannelEntity } from '@entity';
import { useRenameChannelLabelMutation } from '@queries/channel-labels/channel-labels';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { confirmDialog } from '@ui';
import { type Accessor, getOwner } from 'solid-js';
import { useChannelsView } from '../../../../channels-view-context';
import { channelSectionScopeChangeError } from '../../../../core/channel-label-eligibility';
import { useChannelLabelActions } from '../../hooks/useChannelLabelActions';
import { useChannelSectionNotifications } from '../../hooks/useChannelSectionNotifications';

export function useMobileSectionActions(options: {
  enabled: Accessor<boolean>;
  labels: Accessor<readonly ChannelLabel[]>;
  labelsAvailable: Accessor<boolean>;
  canShare: Accessor<boolean>;
  channelsById: Accessor<ReadonlyMap<string, ChannelEntity>>;
  favorites: Accessor<readonly Favorite[]>;
}) {
  const owner = getOwner();
  const userId = useUserId();
  const { setGroupOpen, setLabelOpen } = useChannelsView();
  const personal = useRenameChannelLabelMutation('personal');
  const team = useRenameChannelLabelMutation();
  const actions = useChannelLabelActions({
    sectionsEnabled: () => true,
    channelTagsEnabled: options.enabled,
    labelsAvailable: options.labelsAvailable,
    labelsUnavailableReason: () => t('channelSections.unavailable'),
    sharedLabels: options.canShare,
    labels: options.labels,
    channelsById: options.channelsById,
    searchResults: () => [],
    labelDialogOwner: () => owner,
    setGroupOpen,
    setLabelOpen,
  });
  const notifications = useChannelSectionNotifications({
    enabled: options.enabled,
    labelsAvailable: options.labelsAvailable,
    labels: options.labels,
    favorites: options.favorites,
    dialogOwner: () => owner,
  });
  const changeScope = async (
    label: ChannelLabel,
    shared: boolean,
    teamId?: string
  ) => {
    const actorId = userId();
    if (
      !actorId ||
      !options.labelsAvailable() ||
      Boolean(label.teamId) === shared
    )
      return;
    if (shared && (!options.canShare() || !teamId)) return;
    const error = channelSectionScopeChangeError(
      label,
      options.channelsById(),
      { teamId: shared ? teamId : undefined }
    );
    if (error) {
      toast.failure(
        t(
          error === 'team-only'
            ? 'channelSections.sharingIneligibleChannels'
            : 'channelSections.sharingUnavailableChannels'
        )
      );
      return;
    }
    if (
      !shared &&
      !(await confirmDialog(
        {
          title: t('channelSections.makePersonalTitle'),
          body: t('channelSections.makePersonalBody', { name: label.name }),
          confirmLabel: t('channelSections.makePersonal'),
          cancelLabel: t('channelSections.cancel'),
        },
        { owner }
      ))
    )
      return;
    if (actorId !== userId() || !options.enabled()) return;
    const mutation = label.teamId ? team : personal;
    const result = await catchToResult(() =>
      mutation.mutateAsync({
        actorId,
        labelId: label.id,
        name: label.name,
        rule: label.rule ?? undefined,
        targetScope: shared ? 'team' : 'personal',
      })
    );
    if (result.isErr() && actorId === userId())
      toast.failure(t('channelSections.saveSectionFailed'));
  };
  return {
    ...actions,
    ...notifications,
    changeScope,
    scopePending: () => personal.isPending || team.isPending,
  };
}
