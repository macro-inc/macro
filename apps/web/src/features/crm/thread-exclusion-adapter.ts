import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableCrmThreadExclusions } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { crmEmailPrivacyClient } from '@service-storage/crm-email-privacy';
import { useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  createEmailConsentQuery,
  createEmailPrivacyMutation,
  createThreadExclusionQuery,
} from './queries/email-privacy';

export { ThreadExclusionButton } from './components/thread-exclusion-button';

/** Thread-menu wiring shares privacy mutations and CRM refresh with settings. */
export function useThreadExclusionAction(
  threadId: Accessor<string>,
  isOwner: Accessor<boolean>,
  mailboxLinkId: Accessor<string | undefined>
) {
  const enabled = useFeatureFlag(enableCrmThreadExclusions);
  const team = useCurrentTeamQuery();
  const userId = useUserId();
  const dependencies = {
    client: useQueryClient(),
    privacy: crmEmailPrivacyClient,
    feedback: toast,
  };
  const teamId = () =>
    enabled().enabled && isOwner() && team.isSuccess
      ? team.data?.team.id
      : undefined;
  const consent = createEmailConsentQuery(dependencies, teamId, userId);
  const update = createEmailPrivacyMutation(dependencies, teamId, userId);
  const settings = () => (consent.isSuccess ? consent.data : undefined);
  const status = createThreadExclusionQuery(
    dependencies,
    teamId,
    userId,
    threadId
  );
  const excluded = () =>
    !status.isPending &&
    (status.data?.threads.some((thread) => thread.threadId === threadId()) ??
      false);
  const disabledReason = () => {
    if (!isOwner()) return t('crm.privacyThreadNotOwned');
    if (team.isError || consent.isError)
      return t('crm.privacyThreadLoadFailed');
    if (!team.isSuccess) return t('crm.privacyThreadLoading');
    if (!team.data) return t('crm.privacyThreadNoTeam');
    if (!consent.isSuccess) return t('crm.privacyThreadLoading');
    if (status.isError) return t('crm.privacyThreadLoadFailed');
    if (!status.isSuccess) return t('crm.privacyThreadLoading');
    if (update.isPending) return t('crm.privacyThreadSaving');
    // Removing an existing owner exception does not require contribution consent.
    if (excluded()) return;
    if (!settings()?.enabled) return t('crm.privacyThreadNotShared');
    if (settings()?.mailboxLinkId !== mailboxLinkId())
      return t('crm.privacyThreadOtherMailbox');
  };
  return {
    visible: () => enabled().enabled === true,
    excluded,
    disabledReason,
    label: () =>
      excluded()
        ? t('crm.privacyIncludeThread')
        : t('crm.privacyExcludeThread'),
    toggle: () => {
      if (enabled().enabled !== true || disabledReason()) return;
      const exclude = !excluded();
      update.mutate(
        {
          action: 'set_thread_exclusion',
          thread_id: threadId(),
          excluded: exclude,
        },
        {
          onSuccess: () =>
            toast.success(
              exclude
                ? t('crm.privacyThreadExcluded')
                : t('crm.privacyThreadIncluded')
            ),
        }
      );
    },
  };
}
