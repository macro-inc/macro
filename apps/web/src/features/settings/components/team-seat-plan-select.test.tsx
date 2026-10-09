import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TeamSeatPlanSelect } from './team-seat-plan-select';

afterEach(cleanup);

it('only offers Keep Max for an active Max seat with a pending downgrade', () => {
  const keep = vi.fn();
  const { unmount } = render(() => {
    const [pending, setPending] = createSignal(true);
    return (
      <TeamSeatPlanSelect
        value="max"
        aiUsageBilling={true}
        pendingDowngrade={pending()}
        onChange={(plan) => {
          keep(plan);
          setPending(false);
        }}
      />
    );
  });
  fireEvent.click(screen.getByRole('button', { name: 'Keep Max' }));
  expect(keep).toHaveBeenCalledWith('max');
  expect(screen.queryByRole('button', { name: 'Keep Max' })).toBeNull();
  unmount();
  render(() => (
    <TeamSeatPlanSelect
      value="premium"
      aiUsageBilling={true}
      pendingDowngrade={true}
      onChange={keep}
    />
  ));
  expect(screen.queryByRole('button', { name: 'Keep Max' })).toBeNull();
});

it('hides Keep Max when no downgrade is confirmed and disables it during a change', () => {
  const { unmount } = render(() => (
    <TeamSeatPlanSelect
      value="max"
      aiUsageBilling={true}
      pendingDowngrade={false}
      onChange={() => {}}
    />
  ));
  expect(screen.queryByRole('button', { name: 'Keep Max' })).toBeNull();
  unmount();
  render(() => (
    <TeamSeatPlanSelect
      value="max"
      aiUsageBilling={true}
      pendingDowngrade={true}
      disabled={true}
      onChange={() => {}}
    />
  ));
  expect(
    (screen.getByRole('button', { name: 'Keep Max' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
