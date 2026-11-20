import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { catchToResult } from '@core/util/result';
import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { type Accessor, createSignal, getOwner } from 'solid-js';
import { useChannelsView } from '../../../../channels-view-context';
import { useChannelLabelActions } from '../../hooks/useChannelLabelActions';
import { useChannelSectionNotifications } from '../../hooks/useChannelSectionNotifications';

export function useMobileSectionActions(options: {
  enabled: Accessor<boolean>;
  labels: Accessor<readonly ChannelLabel[]>;
  labelsAvailable: Accessor<boolean>;
  canShare: Accessor<boolean>;
  teamId: Accessor<string | undefined>;
  channelsById: Accessor<ReadonlyMap<string, ChannelEntity>>;
  favorites: Accessor<readonly Favorite[]>;
  onSectionCreated: (labelId: string) => void;
}) {
  const owner = getOwner();
  const { setGroupOpen, setLabelOpen } = useChannelsView();
  const actions = useChannelLabelActions({
    sectionsEnabled: () => true,
    channelTagsEnabled: options.enabled,
    labelsAvailable: options.labelsAvailable,
    labelsUnavailableReason: () => t('channelSections.unavailable'),
    sharedLabels: options.canShare,
    teamId: options.teamId,
    labels: options.labels,
    channelsById: options.channelsById,
    searchResults: () => [],
    labelDialogOwner: () => owner,
    setGroupOpen,
    setLabelOpen,
    onSectionCreated: options.onSectionCreated,
  });
  const notifications = useChannelSectionNotifications({
    enabled: options.enabled,
    labelsAvailable: options.labelsAvailable,
    labels: options.labels,
    favorites: options.favorites,
    dialogOwner: () => owner,
  });
  const [scopePending, setScopePending] = createSignal(false);
  const changeScope = async (label: ChannelLabel, shared: boolean) => {
    if (scopePending() || Boolean(label.teamId) === shared) return;
    setScopePending(true);
    const result = await catchToResult(() =>
      actions.updateSection(
        label,
        label.name,
        label.rule ?? undefined,
        shared ? 'team' : 'personal'
      )
    );
    setScopePending(false);
    if (result.isErr()) toast.failure(t('channelSections.saveSectionFailed'));
  };
  return { ...actions, ...notifications, changeScope, scopePending };
}
