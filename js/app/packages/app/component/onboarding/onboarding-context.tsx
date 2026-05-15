import type { PaidPlanTier, PlanTier } from '@app/component/paywall/plans';
import { PLANS } from '@app/component/paywall/plans';
import {
  createContext,
  createMemo,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

export interface InvitedMember {
  email: string;
  tier: PaidPlanTier;
}

export interface OnboardingContextValue {
  firstName: () => string;
  setFirstName: (v: string) => void;
  lastName: () => string;
  setLastName: (v: string) => void;
  email: () => string;
  setEmail: (v: string) => void;
  teamName: () => string;
  setTeamName: (v: string) => void;
  selectedPlan: () => PlanTier | null;
  setSelectedPlan: (tier: PlanTier | null) => void;
  invitedMembers: () => InvitedMember[];
  setInvitedMembers: (members: InvitedMember[]) => void;
  userSeatCost: () => number;
  teamSeatsCost: () => number;
  totalCost: () => number;
  seatCount: () => number;
  step: () => number;
  setStep: (step: number) => void;
  next: () => void;
  back: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue>();

export function OnboardingProvider(props: ParentProps) {
  const [firstName, setFirstName] = createSignal('');
  const [lastName, setLastName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [teamName, setTeamName] = createSignal('');
  const [selectedPlan, setSelectedPlan] = createSignal<PlanTier | null>(null);
  const [invitedMembers, setInvitedMembers] = createSignal<InvitedMember[]>([]);
  const [step, setStep] = createSignal(0);

  const userSeatCost = createMemo(() => {
    const tier = selectedPlan();
    if (!tier) return 0;
    const plan = PLANS.find((p) => p.tier === tier);
    return plan?.price ?? 0;
  });

  const teamSeatsCost = createMemo(() =>
    invitedMembers().reduce((total, member) => {
      const plan = PLANS.find((p) => p.tier === member.tier);
      return total + (plan?.price ?? 0);
    }, 0)
  );

  const totalCost = () => userSeatCost() + teamSeatsCost();
  const seatCount = () => 1 + invitedMembers().length;

  const TOTAL_STEPS = 4;
  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const value: OnboardingContextValue = {
    firstName,
    setFirstName,
    lastName,
    setLastName,
    email,
    setEmail,
    teamName,
    setTeamName,
    selectedPlan,
    setSelectedPlan,
    invitedMembers,
    setInvitedMembers,
    userSeatCost,
    teamSeatsCost,
    totalCost,
    seatCount,
    step,
    setStep,
    next,
    back,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {props.children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}
