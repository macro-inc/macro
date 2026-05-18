import type { Component } from 'solid-js';
import { IntroStep } from './intro-step';
import { PaymentStep } from './payment-step';
import { ProfileStep } from './profile-step';
import { TeamStep } from './team-step';

export { IntroStep, PaymentStep, ProfileStep, TeamStep };

export interface OnboardingStep {
  id: string;
  label: string;
  component: Component;
}

export const STEPS: OnboardingStep[] = [
  { id: 'intro', label: 'Intro', component: IntroStep },
  { id: 'profile', label: 'Profile', component: ProfileStep },
  { id: 'team', label: 'Team', component: TeamStep },
  { id: 'payment', label: 'Payment', component: PaymentStep },
];
