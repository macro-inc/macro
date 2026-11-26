import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableCrmMemberAccessChanges } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isAgentAccount, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery, usePatchTeamMutation } from '@queries/team/teams';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { Key } from '@solid-primitives/keyed';
import { Button, ToggleSwitch } from '@ui';
import { createMemo, Match, Show, Switch } from 'solid-js';
import { TeamMemberRow } from '../components/team-member-row';
import { SettingsCard, SettingsRow, SettingsSection } from '../primitives';
import {
  hasCrmAccess,
  memberEmail,
  memberName,
  sortTeamMembers,
  useTeamAgents,
} from '../primitives/team-roster';
import { isTeamAdminOrOwner } from '../teamMemberPermissions';
import { crmAccessFixed, roleName } from './shared/team-member-menu';

/**
 * CRM settings' Who can use CRM, for owners and admins while
 * `enable-crm-member-access-changes` is on: every person Members lists, with
 * the CRM access switch their ⋯ there also holds. Anyone else sees nothing.
 */
export function CrmMemberAccessSection() {
  const userId = useUserId();
  const teamQuery = useCurrentTeamQuery();
  const accessChanges = useFeatureFlag(enableCrmMemberAccessChanges);
  const team = () => (queryReadyGate(teamQuery) ? teamQuery.data : undefined);
  const viewerRole = () =>
    team()?.members.find((member) => member.user_id === userId())?.role;
  const canManage = () =>
    isTeamAdminOrOwner(viewerRole()) && accessChanges().enabled;

  return (
    <Show when={canManage() ? team() : undefined}>
      {(team) => <MemberAccessList team={team()} />}
    </Show>
  );
}

function MemberAccessList(props: { team: TeamWithMembers }) {
  const userId = useUserId();
  const save = usePatchTeamMutation();
  const roster = useTeamAgents(() => props.team.team.id);

  // Agent teammates have their own rows in Members, without CRM access; the
  // list waits until they are known, so an agent never shows here with a switch.
  const people = createMemo(() => {
    const agentIds = roster.agents().map((agent) => agent.userId);
    return sortTeamMembers(props.team.members).filter(
      (member) => !agentIds.includes(member.user_id)
    );
  });

  const summary = (member: TeamMember) =>
    crmAccessFixed(member.role)
      ? `${roleName(member.role)} · ${t('crm.memberAccessFixed')}`
      : roleName(member.role);

  const setAccess = (member: TeamMember, enabled: boolean) =>
    save.mutate({
      teamId: props.team.team.id,
      request: { member_crm_access: { user_id: member.user_id, enabled } },
    });

  return (
    <SettingsSection
      title={t('crm.memberAccessTitle')}
      description={t('crm.memberAccessDescription')}
    >
      <Switch
        fallback={
          <SettingsCard>
            <ListSkeleton.Bar class="m-4 h-16 rounded-xl" />
          </SettingsCard>
        }
      >
        <Match when={roster.known()}>
          {/* Scrolls inside the card past about eight people, as Members does. */}
          <SettingsCard class="max-h-[418px] overflow-y-auto! overscroll-contain">
            <Key each={people()} by="user_id">
              {(member) => (
                <TeamMemberRow
                  userId={member().user_id}
                  name={memberName(member())}
                  email={memberEmail(member())}
                  isCurrentUser={member().user_id === userId()}
                  isAgent={isAgentAccount(tryMacroId(member().user_id))}
                  summary={summary(member())}
                  menu={
                    <ToggleSwitch
                      size="md"
                      label={t('crm.memberAccessFor', {
                        name: memberName(member()),
                      })}
                      labelClass="sr-only"
                      class="shrink-0 justify-center touch:min-h-11 touch:min-w-11"
                      checked={hasCrmAccess(
                        member(),
                        props.team.crm_member_access
                      )}
                      disabled={crmAccessFixed(member().role) || save.isPending}
                      onChange={(enabled) => setAccess(member(), enabled)}
                    />
                  }
                />
              )}
            </Key>
          </SettingsCard>
        </Match>
        <Match when={roster.failed()}>
          <SettingsCard>
            <SettingsRow
              label={
                <span role="alert" class="text-failure">
                  {t('crm.memberAccessLoadFailed')}
                </span>
              }
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fireAndForget(roster.retry(), 'crm')}
              >
                {t('crm.tryAgain')}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </Match>
      </Switch>
    </SettingsSection>
  );
}
