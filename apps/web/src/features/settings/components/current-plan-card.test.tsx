import type { PlanTier } from '@app/features/paywall/plans';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CurrentPlanCard } from './current-plan-card';

afterEach(cleanup);

it.each<[PlanTier, string]>([
  ['free', 'Free plan'],
  ['premium', 'Pro plan'],
  ['max', 'Max plan'],
])('shows the %s tier by its display name', (tier, label) => {
  render(() => <CurrentPlanCard tier={tier} onOpen={() => {}} />);
  expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
});

it('shows a loading label until the tier resolves, then the plan', () => {
  const [tier, setTier] = createSignal<PlanTier>();
  render(() => <CurrentPlanCard tier={tier()} onOpen={() => {}} />);
  expect(screen.getByText('Loading plan…')).toBeTruthy();
  setTier('max');
  expect(screen.queryByText('Loading plan…')).toBeNull();
  expect(screen.getByText('Max plan')).toBeTruthy();
});

it('opens billing when the card is clicked', () => {
  const open = vi.fn();
  render(() => <CurrentPlanCard tier="premium" onOpen={open} />);
  fireEvent.click(screen.getByRole('button', { name: /Pro plan/ }));
  expect(open).toHaveBeenCalledOnce();
});
