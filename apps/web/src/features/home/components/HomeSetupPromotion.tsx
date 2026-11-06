import { HOME_SETUP_PROMOTION as COPY } from '@app/features/sidebar-promotion/core/promotions';
import { createLastKnown } from '@app/features/sidebar-promotion/primitives/last-known';
import {
  allOf,
  flagVerdict,
  SidebarPromotion,
} from '@app/features/sidebar-promotion/sidebar-promotion';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSidebarPromotions } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import { untrack } from 'solid-js';
import { z } from 'zod';

/** Home's prompt to connect tools (Settings → Integrations) and invite teammates (Settings → Team). */
export function HomeSetupPromotion(props: { class?: string }) {
  const promotions = useFeatureFlag(enableSidebarPromotions);
  const { openSettings } = useSettingsState();
  const team = useCurrentTeamQuery(() => promotions().enabled);
  const isAdmin = useIsTeamAdmin();
  const userId = useUserId();
  // Settings → Team can invite (or create a team with invites) unless the
  // user is a member of a team that limits invites to admins. Until the team
  // loads, the card keeps the answer this browser last saw.
  const canInvite = createLastKnown(
    'home-setup:can-invite',
    untrack(userId),
    () => {
      if (team.isPending) return undefined;
      const current = team.data?.team;
      return !current || isAdmin() || current.allow_non_admin_invites !== false;
    },
    z.boolean()
  );
  return (
    <SidebarPromotion
      id={COPY.id}
      applies={allOf(
        flagVerdict(promotions()),
        canInvite() === undefined ? undefined : true
      )}
      logos={COPY.logos}
      headline={COPY.headline}
      pitch={COPY.pitch}
      class={props.class}
      dismissLabel="Dismiss workspace setup"
      action={{
        label: COPY.action,
        onClick: () => openSettings('Connected'),
      }}
      secondaryAction={
        canInvite()
          ? {
              label: COPY.secondaryAction,
              onClick: () => openSettings('Team'),
            }
          : undefined
      }
    />
  );
}
