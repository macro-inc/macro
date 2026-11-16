import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableCrmThreadExclusions } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { crmEmailPrivacyClient } from '@service-storage/crm-email-privacy';
import { useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createEmailPrivacyMutation } from './queries/email-privacy';

/** Thread-menu wiring shares privacy mutations and CRM refresh with settings. */
export function useThreadExclusionAction(
  threadId: Accessor<string>,
  isOwner: Accessor<boolean>
) {
  const enabled = useFeatureFlag(enableCrmThreadExclusions);
  const team = useCurrentTeamQuery();
  const userId = useUserId();
  const update = createEmailPrivacyMutation(
    {
      client: useQueryClient(),
      privacy: crmEmailPrivacyClient,
      feedback: toast,
    },
    () => (team.isSuccess ? team.data?.team.id : undefined),
    userId
  );
  return {
    available: () =>
      enabled().enabled === true && isOwner() && team.isSuccess && !!team.data,
    exclude: () => {
      if (
        enabled().enabled !== true ||
        !isOwner() ||
        !team.isSuccess ||
        !team.data ||
        update.isPending
      )
        return;
      update.mutate(
        {
          action: 'set_thread_exclusion',
          thread_id: threadId(),
          excluded: true,
        },
        { onSuccess: () => toast.success(t('crm.privacyThreadExcluded')) }
      );
    },
  };
}
