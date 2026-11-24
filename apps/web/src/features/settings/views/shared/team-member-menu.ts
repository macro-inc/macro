import { PLANS } from '@app/features/paywall/plans';
import { t } from '@app/lib/i18n';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import { match } from 'ts-pattern';

/** Why the viewer can't change a member's role. */
export type RoleLock = 'owner' | 'not-owner';

/** Why the viewer can't remove a member. */
export type RemovalLock = 'owner' | 'self';

/**
 * Everything a person's ⋯ holds in Team › Members, in the order the menu
 * shows it: seat plan, role, CRM access, then Remove. The desktop menu and
 * the touch sheet take the same props.
 */
export type TeamMemberMenuProps = {
  name: string;
  email?: string;
  /** The seat plan, when the team bills per seat. */
  plan?: PaidPlan;
  /** A seat that moves to a cheaper plan at renewal; Keep cancels that. */
  pendingDowngrade: boolean;
  planPending: boolean;
  onPlanChange: (plan: PaidPlan) => void;
  role: TeamRole;
  roleLock?: RoleLock;
  onRoleChange: (role: TeamRole) => void;
  /** Whether the viewer manages CRM access on this team. */
  manageCrm: boolean;
  crmAccess: boolean;
  crmPending: boolean;
  onCrmAccessChange: (enabled: boolean) => void;
  removalLock?: RemovalLock;
  onRemove: () => void;
};

/** An agent teammate's ⋯; each action is left out for viewers who can't take it. */
export type TeamAgentMenuProps = {
  name: string;
  onChangeVoice?: () => void;
  onRemove?: () => void;
};

type SeatPlanOption = {
  value: PaidPlan;
  label: string;
  description: string;
};

/** Every paid plan a seat can be moved to, cheapest first, described by its
 * AI usage: a seat's price depends on whether the team bills monthly or
 * annually. */
export function seatPlanOptions(): SeatPlanOption[] {
  return PLANS.flatMap((plan) => {
    if (plan.tier === 'free') return [];
    return [
      {
        value: plan.tier,
        label: plan.name,
        description: match(plan.tier)
          .with('premium', () => t('teamMembers.usagePremium'))
          .with('business', () => t('teamMembers.usageBusiness'))
          .with('max', () => t('teamMembers.usageMax'))
          .exhaustive(),
      },
    ];
  });
}

export function seatPlanName(plan: PaidPlan): string {
  return (
    seatPlanOptions().find((option) => option.value === plan)?.label ?? plan
  );
}

/** The roles an owner can give a member or admin. */
export const ASSIGNABLE_ROLES = [TeamRole.member, TeamRole.admin];

/** A role as the server sends it; one this build doesn't know shows as sent. */
export function roleName(role: TeamRole): string {
  return match(role)
    .with(TeamRole.owner, () => t('teamMembers.owner'))
    .with(TeamRole.admin, () => t('teamMembers.admin'))
    .with(TeamRole.member, () => t('teamMembers.member'))
    .exhaustive(() => role);
}

export function roleLockReason(lock: RoleLock): string {
  return match(lock)
    .with('owner', () => t('teamMembers.roleLockedOwner'))
    .with('not-owner', () => t('teamMembers.roleLockedNotOwner'))
    .exhaustive();
}

export function removalLockReason(lock: RemovalLock): string {
  return match(lock)
    .with('owner', () => t('teamMembers.removeLockedOwner'))
    .with('self', () => t('teamMembers.removeLockedSelf'))
    .exhaustive();
}

/** Owners and admins always have CRM access; only a member's can change. */
export function crmAccessFixed(role: TeamRole): boolean {
  return role !== TeamRole.member;
}
