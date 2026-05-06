import {
  createContext,
  createMemo,
  createSignal,
  useContext,
  type ParentProps,
} from 'solid-js';
import type { PlanTier } from '@app/component/paywall/plans';
import { PLANS } from '@app/component/paywall/plans';

export interface InvitedMember {
  email: string;
  tier: PlanTier;
}

export interface OnboardingContextValue {
  selectedPlan: () => PlanTier | null;
  setSelectedPlan: (tier: PlanTier | null) => void;
  invitedMembers: () => InvitedMember[];
  setInvitedMembers: (members: InvitedMember[]) => void;
  teamName: () => string;
  setTeamName: (name: string) => void;
  /** Cost for the current user's seat */
  userSeatCost: () => number;
  /** Total cost for all invited team members */
  teamSeatsCost: () => number;
  /** Total monthly cost (user + team) */
  totalCost: () => number;
  /** Number of seats including the user */
  seatCount: () => number;
}

const OnboardingContext = createContext<OnboardingContextValue>();

export function OnboardingProvider(props: ParentProps) {
  const [selectedPlan, setSelectedPlan] = createSignal<PlanTier | null>(null);
  const [invitedMembers, setInvitedMembers] = createSignal<InvitedMember[]>([]);
  const [teamName, setTeamName] = createSignal('');

  const userSeatCost = createMemo(() => {
    const tier = selectedPlan();
    if (!tier) return 0;
    const plan = PLANS.find((p) => p.tier === tier);
    return plan?.price ?? 0;
  });

  const teamSeatsCost = createMemo(() => {
    return invitedMembers().reduce((total, member) => {
      const plan = PLANS.find((p) => p.tier === member.tier);
      return total + (plan?.price ?? 0);
    }, 0);
  });

  const totalCost = () => userSeatCost() + teamSeatsCost();

  const seatCount = () => 1 + invitedMembers().length;

  const value: OnboardingContextValue = {
    selectedPlan,
    setSelectedPlan,
    invitedMembers,
    setInvitedMembers,
    teamName,
    setTeamName,
    userSeatCost,
    teamSeatsCost,
    totalCost,
    seatCount,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {props.children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
