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
  canAssignChannel,
  canLabelChannel,
  filterChannelLabelMembers,
} from '../../../core/channel-label-eligibility';
import type { ChannelsRailSection } from '../../../types';
import { promptLabelName } from '../ChannelLabelNameDialog';
import { promptSectionChannels } from '../next/SectionChannelsDialog';
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
      return t('channelSections.labelsNoAccess');
    }

    const message = error instanceof Error ? error.message : '';
    return message || fallback;
  };

  const labelChannelById = (channelId: string) =>
    channelsById().get(channelId) ??
    searchResults().find((channel) => channel.id === channelId);
  const channelName = (channelId: string) => {
    const name = labelChannelById(channelId)?.name;
    return name ? `#${name}` : t('channelSections.unnamedChannel');
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

    if (!channelTagsEnabled() || !channelIds.every(canLabelChannelId)) {
      return;
    }

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
        ) {
          throw new Error(t('channelSections.unavailable'));
        }

        if (scope === 'team' && !sharedLabels()) {
          throw new Error(t('channelSections.noAccess'));
        }

        const members = rule ? [] : channelIds;
        if (
          !members.every(
            (id) =>
              canLabelChannelId(id) &&
              (scope === 'personal' ||
                labelChannelById(id)?.channelType === 'team')
          )
        ) {
          throw new Error(t('channelSections.ineligibleChannel'));
        }

        const created = await mutationsForScope(scope).create.mutateAsync({
          name,
          rule,
          channelIds: members,
          actorId,
        });
        span.setAttr('section.id', created.id);

        if (actorId !== userId()) {
          return;
        }

        if (!sectionMode) {
          setGroupOpen('team_channels', true);
        }

        setLabelOpen(created.id, true);
        toast.success(t('channelSections.created', { name }));
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

    if (!channelTagsEnabled()) {
      return;
    }

    const scope = scopeForLabel(label);
    const save = ({
      name,
      rule,
      scope: nextScope = scope,
    }: {
      name: string;
      rule?: ChannelLabelRule;
      scope?: ChannelLabelScopeSelection;
    }) =>
      Telemetry.span('channels.section.update', async (span) => {
        span.setAttr('section.id', label.id);
        span.setAttr('section.scope', scope);
        span.setAttr('section.smart', Boolean(rule));
        span.setAttr('section.target_scope', nextScope);

        const current = labels().find((item) => item.id === label.id);

        if (
          actorId !== userId() ||
          sectionMode !== sectionsEnabled() ||
          !channelTagsEnabled() ||
          !current ||
          scopeForLabel(current) !== scope ||
          !labelsAvailable()
        ) {
          throw new Error(t('channelSections.unavailable'));
        }

        await mutationsForScope(scope).rename.mutateAsync({
          labelId: label.id,
          name,
          rule,
          targetScope: nextScope === scope ? undefined : nextScope,
          actorId,
        });

        if (actorId !== userId()) {
          return;
        }

        toast.success(t('channelSections.updated', { name }));
      });

    if (sectionMode) {
      await promptSection(
        {
          scope,
          canShare: sharedLabels(),
          initial: label,
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

    if (!channelTagsEnabled()) {
      return;
    }

    const sectionMode = sectionsEnabled();
    let channelsText: string;

    if (label.rule) {
      channelsText = t('channelSections.deleteSmartChannels');
    } else if (label.channelCount === 0) {
      channelsText = t('channelSections.deleteEmptyChannels');
    } else {
      channelsText = t('channelSections.conversationsRemain');
    }

    const confirmed = await confirmDialog(
      {
        title: t('channelSections.deleteConfirmTitle', { name: label.name }),
        body: t('channelSections.deleteConfirmBody', {
          scopeDescription: labelScopeDescription(scopeForLabel(label)),
          channelsText,
        }),
        confirmLabel: label.teamId
          ? t('channelSections.deleteForEveryone')
          : t('channelSections.deleteSection'),
        cancelLabel: t('channelSections.cancel'),
        tone: 'danger',
      },
      { owner: labelDialogOwner() }
    );

    if (
      !confirmed ||
      !channelTagsEnabled() ||
      userId() !== actorId ||
      sectionMode !== sectionsEnabled()
    ) {
      return;
    }

    try {
      await Telemetry.span('channels.section.delete', async (span) => {
        span.setAttr('section.id', label.id);
        span.setAttr('section.scope', scopeForLabel(label));
        await mutationsForScope(scopeForLabel(label)).delete.mutateAsync({
          labelId: label.id,
          actorId,
        });
      });

      if (actorId !== userId()) {
        return;
      }

      toast.success(t('channelSections.deleted', { name: label.name }));
    } catch (error) {
      if (actorId !== userId()) {
        return;
      }

      toast.failure(
        errorMessage(error, t('channelSections.deleteLabelFailed'))
      );
    }
  };

  const addChannelsToLabel = async (label: ChannelLabel) => {
    if (!sectionsEnabled() || !channelTagsEnabled() || label.rule) {
      return;
    }

    if (!labelsAvailable()) {
      toast.failure(labelsUnavailableReason());
      return;
    }

    const actorId = userId();
    const scope = scopeForLabel(label);

    await promptSectionChannels(
      {
        label,
        onConfirm: (channelIds) =>
          Telemetry.span('channels.section.add_channels', async (span) => {
            span.setAttr('section.id', label.id);
            span.setAttr('section.scope', scope);
            span.setAttr('channel.ids', channelIds.join(','));

            const current = labels().find((item) => item.id === label.id);

            if (
              actorId !== userId() ||
              !sectionsEnabled() ||
              !channelTagsEnabled() ||
              !labelsAvailable() ||
              !current ||
              current.rule ||
              scopeForLabel(current) !== scope
            ) {
              throw new Error(t('channelSections.unavailable'));
            }

            const additions = [...new Set(channelIds)].filter(
              (id) => !current.channelIds.includes(id)
            );
            const results = await Promise.allSettled(
              additions.map((channelId) =>
                mutationsForScope(scope).assign.mutateAsync({
                  channelId,
                  labelId: label.id,
                  actorId,
                })
              )
            );

            if (actorId !== userId() || !sectionsEnabled()) {
              throw new Error(t('channelSections.unavailable'));
            }

            const failed = additions.filter(
              (_, index) => results[index].status === 'rejected'
            );
            const added = additions.length - failed.length;
            span.setAttr('channels.added', added);
            span.setAttr('channels.failed', failed.length);

            if (failed.length) {
              span.error('Some channel assignments failed');
            }

            if (added > 0) {
              setLabelOpen(label.id, true);
              toast.success(
                t('channelSections.addedChannels', { count: added })
              );
            }

            return failed;
          }),
      },
      { owner: labelDialogOwner() }
    );
  };

  const setChannelLabel = (
    channelId: string,
    labelId: string | undefined,
    fromLabelId?: string
  ) => {
    const actorId = userId();

    if (!channelTagsEnabled() || !canLabelChannelId(channelId)) {
      return;
    }

    const to = labelId
      ? labels().find((label) => label.id === labelId)
      : undefined;
    const previous = fromLabelId
      ? labels().find((label) => label.id === fromLabelId)
      : undefined;

    if (
      labelId &&
      (!to || !canAssignChannel(labelChannelById(channelId), to))
    ) {
      return;
    }

    let scope: ChannelLabelScopeSelection;

    if (to) {
      scope = scopeForLabel(to);
    } else if (previous) {
      scope = scopeForLabel(previous);
    } else {
      scope = defaultScope();
    }

    const from = labels().find(
      (label) =>
        !label.rule &&
        scopeForLabel(label) === scope &&
        label.channelIds.includes(channelId)
    );

    if (to?.rule || from?.id === labelId) {
      return;
    }

    if (labelId) {
      setLabelOpen(labelId, true);
    }

    fireAndForget(
      Telemetry.span('channels.section.assign', async (span) => {
        span.setAttr('channel.id', channelId);
        span.setAttr('section.scope', scope);

        if (labelId) {
          span.setAttr('section.id', labelId);
        }

        if (from) {
          span.setAttr('section.previous_id', from.id);
        }

        try {
          await mutationsForScope(scope).assign.mutateAsync({
            channelId,
            labelId,
            actorId,
          });

          if (actorId !== userId()) {
            return;
          }

          if (to) {
            toast.success(
              t('channelSections.movedChannel', {
                channel: channelName(channelId),
                name: to.name,
              })
            );
          } else if (from) {
            toast.success(
              t('channelSections.removedChannel', {
                channel: channelName(channelId),
                name: from.name,
              })
            );
          }
        } catch (error) {
          if (actorId === userId()) {
            toast.failure(
              errorMessage(error, t('channelSections.moveChannelFailed'))
            );
          }

          throw error;
        }
      }),
      'channels-view'
    );
  };

  const markLabelRead = async (label: ChannelLabel) => {
    if (!channelTagsEnabled()) {
      return;
    }

    const channelIds = new Set(
      filterChannelLabelMembers(label.channelIds, channelsById())
    );

    if (channelIds.size === 0) {
      return;
    }

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
        errorMessage(error, t('channelSections.markLabelReadFailed'))
      );
    }
  };

  return {
    createLabel,
    createSmartTag,
    renameLabel,
    addChannelsToLabel,
    deleteLabel,
    setChannelLabel,
    markLabelRead,
    canLabelChannelId,
    labelChannelById,
  };
}
