import { t } from '@app/lib/i18n';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import type { ChannelEntity } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import { Telemetry } from '@macro-inc/observability';
import { ensureNotificationSourceLoaded } from '@notifications/notification-helpers';
import {
  useCreateChannelLabelMutation,
  useDeleteChannelLabelMutation,
  useRenameChannelLabelMutation,
  useSetChannelLabelMutation,
} from '@queries/channel-labels/channel-labels';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import type { ChannelLabelScopeSelection } from '@service-storage/generated/schemas/channelLabelScopeSelection';
import { confirmDialog } from '@ui';
import type { Accessor, Owner } from 'solid-js';
import {
  canLabelChannel,
  filterChannelLabelMembers,
} from '../../../core/channel-label-eligibility';
import type { ChannelsRailSection } from '../../../types';
import { promptLabelName } from '../ChannelLabelNameDialog';
import { promptSection, type SectionDialogValue } from '../next/SectionDialog';
import { promptSmartTag } from '../SmartTagDialog';

type ChannelLabelActionsOptions = {
  sectionsEnabled: Accessor<boolean>;
  channelTagsEnabled: Accessor<boolean>;
  labelsAvailable: Accessor<boolean>;
  labelsUnavailableReason: Accessor<string>;
  sharedLabels: Accessor<boolean>;
  labels: Accessor<readonly ChannelLabel[]>;
  channelsById: Accessor<ReadonlyMap<string, ChannelEntity>>;
  searchResults: Accessor<readonly ChannelEntity[]>;
  labelDialogOwner: Accessor<Owner | null | undefined>;
  setGroupOpen: (group: ChannelsRailSection, open: boolean) => void;
  setLabelOpen: (labelId: string, open: boolean) => void;
};

export function useChannelLabelActions(options: ChannelLabelActionsOptions) {
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const {
    sectionsEnabled,
    channelTagsEnabled,
    labelsAvailable,
    labelsUnavailableReason,
    sharedLabels,
    labels,
    channelsById,
    searchResults,
    labelDialogOwner,
    setGroupOpen,
    setLabelOpen,
  } = options;
  // Explain shared versus private scope before creating or changing labels.
  const mutations = {
    personal: {
      create: useCreateChannelLabelMutation('personal'),
      rename: useRenameChannelLabelMutation('personal'),
      delete: useDeleteChannelLabelMutation('personal'),
      assign: useSetChannelLabelMutation('personal'),
    },
    team: {
      create: useCreateChannelLabelMutation(),
      rename: useRenameChannelLabelMutation(),
      delete: useDeleteChannelLabelMutation(),
      assign: useSetChannelLabelMutation(),
    },
  };
  const defaultScope = (): ChannelLabelScopeSelection =>
    sectionsEnabled() || !sharedLabels() ? 'personal' : 'team';
  // Legacy endpoints and their cache keys use the implicit account/team scope.
  const mutationsForScope = (scope: ChannelLabelScopeSelection) =>
    sectionsEnabled() ? mutations[scope] : mutations.team;

  const errorMessage = (error: unknown, fallback: string) => {
    if (
      thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
      thrownResultErrorHasCode(error, 'FORBIDDEN')
    ) {
      return 'You do not have access to these labels.';
    }
    const message = error instanceof Error ? error.message : '';
    return message || fallback;
  };
  const labelChannelById = (channelId: string) =>
    channelsById().get(channelId) ??
    searchResults().find((channel) => channel.id === channelId);
  const channelName = (channelId: string) => {
    const name = labelChannelById(channelId)?.name;
    return name ? `#${name}` : 'the channel';
  };
  const canLabelChannelId = (channelId: string) =>
    canLabelChannel(labelChannelById(channelId)) &&
    (sectionsEnabled() || labelChannelById(channelId)?.channelType === 'team');

  const scopeForLabel = (label: ChannelLabel): ChannelLabelScopeSelection =>
    label.teamId ? 'team' : 'personal';
  const labelScopeDescription = (scope: ChannelLabelScopeSelection) => {
    if (!sectionsEnabled()) {
      return t(
        scope === 'team'
          ? 'channelLabels.sharedScopeDescription'
          : 'channelLabels.personalScopeDescription'
      );
    }
    return t(
      scope === 'team'
        ? 'channelSections.teamDescription'
        : 'channelSections.personalDescription'
    );
  };

  const createLabel = async (
    channelIds: string[],
    scope: ChannelLabelScopeSelection = defaultScope(),
    smart = false
  ) => {
    const actorId = userId();
    const sectionMode = sectionsEnabled();
    if (!channelTagsEnabled() || !channelIds.every(canLabelChannelId)) return;
    if (!labelsAvailable()) {
      toast.failure(labelsUnavailableReason());
      return;
    }
    const save = ({ name, scope, rule }: SectionDialogValue) =>
      Telemetry.span('channels.section.create', async (span) => {
        span.setAttr('section.scope', scope);
        span.setAttr('section.smart', Boolean(rule));
        if (
          actorId !== userId() ||
          sectionMode !== sectionsEnabled() ||
          !channelTagsEnabled() ||
          !labelsAvailable()
        )
          throw new Error(t('channelSections.unavailable'));
        if (scope === 'team' && !sharedLabels())
          throw new Error(t('channelSections.noAccess'));
        const members = rule ? [] : channelIds;
        if (
          !members.every(
            (id) =>
              canLabelChannelId(id) &&
              (scope === 'personal' ||
                labelChannelById(id)?.channelType === 'team')
          )
        )
          throw new Error(t('channelSections.ineligibleChannel'));
        const created = await mutationsForScope(scope).create.mutateAsync({
          name,
          rule,
          channelIds: members,
          actorId,
        });
        span.setAttr('section.id', created.id);
        if (actorId !== userId()) return;
        if (!sectionMode) setGroupOpen('team_channels', true);
        setLabelOpen(created.id, true);
        toast.success(`Created “${name}”`);
      });

    if (sectionMode) {
      await promptSection(
        { scope, canShare: sharedLabels(), onConfirm: save },
        { owner: labelDialogOwner() }
      );
    } else if (smart) {
      await promptSmartTag(
        {
          scopeDescription: labelScopeDescription(scope),
          onConfirm: (name, rule) => save({ name, scope, rule }),
        },
        { owner: labelDialogOwner() }
      );
    } else {
      await promptLabelName(
        {
          title: t('channelLabels.newLabel'),
          body: labelScopeDescription(scope),
          confirmLabel: t('channelLabels.createLabel'),
          onConfirm: (name) => save({ name, scope }),
        },
        { owner: labelDialogOwner() }
      );
    }
  };

  const createSmartTag = () => createLabel([], defaultScope(), true);

  const renameLabel = async (label: ChannelLabel) => {
    const actorId = userId();
    const sectionMode = sectionsEnabled();
    if (!channelTagsEnabled()) return;
    const scope = scopeForLabel(label);
    const save = ({ name, rule }: { name: string; rule?: ChannelLabelRule }) =>
      Telemetry.span('channels.section.update', async (span) => {
        span.setAttr('section.id', label.id);
        span.setAttr('section.scope', scope);
        span.setAttr('section.smart', Boolean(rule));
        if (
          actorId !== userId() ||
          sectionMode !== sectionsEnabled() ||
          !channelTagsEnabled() ||
          !labelsAvailable()
        )
          throw new Error(t('channelSections.unavailable'));
        await mutationsForScope(scope).rename.mutateAsync({
          labelId: label.id,
          name,
          rule,
          actorId,
        });
        if (actorId !== userId()) return;
        toast.success(`Updated “${name}”`);
      });
    if (sectionMode) {
      await promptSection(
        {
          scope,
          canShare: sharedLabels(),
          initial: { name: label.name, rule: label.rule ?? undefined },
          onConfirm: save,
        },
        { owner: labelDialogOwner() }
      );
    } else if (label.rule) {
      await promptSmartTag(
        {
          scopeDescription: labelScopeDescription(scope),
          initial: { name: label.name, rule: label.rule },
          onConfirm: (name, rule) => save({ name, rule }),
        },
        { owner: labelDialogOwner() }
      );
    } else {
      await promptLabelName(
        {
          title: t('channelLabels.renameLabel'),
          body: labelScopeDescription(scope),
          confirmLabel: t('channelLabels.rename'),
          initialValue: label.name,
          onConfirm: (name) => save({ name }),
        },
        { owner: labelDialogOwner() }
      );
    }
  };

  const deleteLabel = async (label: ChannelLabel) => {
    const actorId = userId();
    if (!channelTagsEnabled()) return;
    const sectionMode = sectionsEnabled();
    const channelsText = label.rule
      ? 'Channels stop appearing in this smart label. Other labels are unchanged.'
      : label.channelCount === 0
        ? 'It has no channels in it.'
        : t('channelSections.conversationsRemain');
    const confirmed = await confirmDialog(
      {
        title: `Delete “${label.name}”?`,
        body: `${labelScopeDescription(scopeForLabel(label))} ${channelsText} Nobody loses access to a channel.`,
        confirmLabel: label.teamId
          ? t('channelSections.deleteForEveryone')
          : t('channelSections.deleteSection'),
        cancelLabel: 'Cancel',
        tone: 'danger',
      },
      { owner: labelDialogOwner() }
    );
    if (
      !confirmed ||
      !channelTagsEnabled() ||
      userId() !== actorId ||
      sectionMode !== sectionsEnabled()
    )
      return;
    try {
      await Telemetry.span('channels.section.delete', async (span) => {
        span.setAttr('section.id', label.id);
        span.setAttr('section.scope', scopeForLabel(label));
        await mutationsForScope(scopeForLabel(label)).delete.mutateAsync({
          labelId: label.id,
          actorId,
        });
      });
      if (actorId !== userId()) return;
      toast.success(`Deleted “${label.name}”`);
    } catch (error) {
      if (actorId !== userId()) return;
      toast.failure(errorMessage(error, 'Failed to delete label'));
    }
  };

  const setChannelLabel = (
    channelId: string,
    labelId: string | undefined,
    fromLabelId?: string
  ) => {
    const actorId = userId();
    if (!channelTagsEnabled() || !canLabelChannelId(channelId)) return;
    const to = labelId
      ? labels().find((label) => label.id === labelId)
      : undefined;
    const previous = fromLabelId
      ? labels().find((label) => label.id === fromLabelId)
      : undefined;
    if (labelId && (!to || !canLabelChannel(labelChannelById(channelId), to)))
      return;
    const scope = to
      ? scopeForLabel(to)
      : previous
        ? scopeForLabel(previous)
        : sectionsEnabled()
          ? 'personal'
          : sharedLabels()
            ? 'team'
            : 'personal';
    const from = labels().find(
      (label) =>
        !label.rule &&
        scopeForLabel(label) === scope &&
        label.channelIds.includes(channelId)
    );
    if (to?.rule || from?.id === labelId) return;
    if (labelId) setLabelOpen(labelId, true);
    fireAndForget(
      Telemetry.span('channels.section.assign', async (span) => {
        span.setAttr('channel.id', channelId);
        span.setAttr('section.scope', scope);
        if (labelId) span.setAttr('section.id', labelId);
        if (from) span.setAttr('section.previous_id', from.id);
        try {
          await mutationsForScope(scope).assign.mutateAsync({
            channelId,
            labelId,
            actorId,
          });
          if (actorId !== userId()) return;
          if (to) {
            toast.success(`Moved ${channelName(channelId)} to “${to.name}”`);
          } else if (from) {
            toast.success(
              `Removed ${channelName(channelId)} from “${from.name}”`
            );
          }
        } catch (error) {
          if (actorId === userId())
            toast.failure(errorMessage(error, 'Failed to move channel'));
          throw error;
        }
      }),
      'channels-view'
    );
  };

  const markLabelRead = async (label: ChannelLabel) => {
    if (!channelTagsEnabled()) return;
    const channelIds = new Set(
      filterChannelLabelMembers(label.channelIds, channelsById())
    );
    if (channelIds.size === 0) return;
    try {
      await ensureNotificationSourceLoaded(notificationSource);
      const unread = notificationSource
        .notifications()
        .filter(
          (notification) =>
            notification.entity_type === 'channel' &&
            channelIds.has(notification.entity_id) &&
            !notificationIsRead(notification)
        );
      await notificationSource.bulkMarkAsRead(unread);
    } catch (error) {
      toast.failure(
        errorMessage(error, 'Failed to mark channel label as read')
      );
    }
  };

  return {
    createLabel,
    createSmartTag,
    renameLabel,
    deleteLabel,
    setChannelLabel,
    markLabelRead,
    canLabelChannelId,
    labelChannelById,
  };
}
