import type { PaidPlanTier, PlanTier } from '@app/component/paywall/plans';
import { PLANS } from '@app/component/paywall/plans';
import {
  createContext,
  createMemo,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';

export interface InvitedMember {
  email: string;
  tier: PaidPlanTier;
}

export type StepStatus = 'pending' | 'completed' | 'skipped';

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
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
  steps: StepState[];
  setSteps: SetStoreFunction<StepState[]>;
  skipStep: (id: string) => void;
  completeStep: (id: string) => void;
  isStepSkipped: (id: string) => boolean;
}

const OnboardingContext = createContext<OnboardingContextValue>();

export function OnboardingProvider(
  props: ParentProps & {
    steps: Array<{ id: string; label: string }>;
  }
) {
  const [firstName, setFirstName] = createSignal('');
  const [lastName, setLastName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [teamName, setTeamName] = createSignal('');
  const [selectedPlan, setSelectedPlan] = createSignal<PlanTier | null>(null);
  const [invitedMembers, setInvitedMembers] = createSignal<InvitedMember[]>([]);
  const [step, setStep] = createSignal(0);

  const [steps, setSteps] = createStore<StepState[]>(
    props.steps.map((s) => ({ id: s.id, label: s.label, status: 'pending' }))
  );

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

  const isStepSkipped = (id: string) =>
    steps.find((s) => s.id === id)?.status === 'skipped';

  const next = () =>
    setStep((s) => {
      let n = s + 1;
      while (n < steps.length && steps[n]?.status === 'skipped') n++;
      return Math.min(n, steps.length - 1);
    });

  const back = () =>
    setStep((s) => {
      let n = s - 1;
      while (n > 0 && steps[n]?.status === 'skipped') n--;
      return Math.max(n, 0);
    });

  const skipStep = (id: string) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx !== -1) setSteps(idx, 'status', 'skipped');
  };

  const completeStep = (id: string) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx !== -1) setSteps(idx, 'status', 'completed');
  };

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
    steps,
    setSteps,
    skipStep,
    completeStep,
    isStepSkipped,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {props.children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx)
    throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}
