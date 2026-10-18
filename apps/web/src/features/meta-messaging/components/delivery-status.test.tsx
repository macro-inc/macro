/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeliveryState } from '../core/delivery';
import { DeliveryStatus } from './delivery-status';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps quick sends quiet and shows progress only after five seconds', () => {
  vi.useFakeTimers();
  const [state, setState] = createSignal<DeliveryState>('pending');
  render(() => (
    <DeliveryStatus state={state()} provider="whatsapp" onRecover={vi.fn()} />
  ));
  expect(screen.queryByRole('status')).toBeNull();
  vi.advanceTimersByTime(4_999);
  expect(screen.queryByRole('status')).toBeNull();
  vi.advanceTimersByTime(1);
  expect(screen.getByRole('status', { name: 'Still sending…' })).toBeTruthy();
  for (const value of ['accepted', 'sent', 'delivered', 'read'] as const) {
    setState(value);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  }
});

it('puts understandable failure and explicit recovery together', () => {
  const recover = vi.fn();
  render(() => (
    <DeliveryStatus
      state="failed"
      provider="instagram"
      error="configuration_required"
      onRecover={recover}
    />
  ));
  expect(screen.getByText(/administrator/)).toBeTruthy();
  expect(screen.queryByText(/encryption/)).toBeNull();
  expect(recover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit and retry' }));
  expect(recover).toHaveBeenCalledOnce();
});

it('shows an uncertain send as a review action and hides recovery without permission', () => {
  render(() => (
    <DeliveryStatus state="unknown" provider="whatsapp" onRecover={vi.fn()} />
  ));
  expect(screen.getByText(/may have arrived/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Review reply' })).toBeTruthy();
  cleanup();
  render(() => <DeliveryStatus state="failed" provider="whatsapp" />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('does not flash progress after a fast send settles', () => {
  vi.useFakeTimers();
  const [state, setState] = createSignal<DeliveryState>('pending');
  render(() => <DeliveryStatus state={state()} provider="instagram" />);
  vi.advanceTimersByTime(1_000);
  setState('accepted');
  vi.advanceTimersByTime(10_000);
  expect(screen.queryByRole('status')).toBeNull();
});

it('shows an already delayed durable attempt immediately after reopening', () => {
  render(() => (
    <DeliveryStatus
      state="pending"
      provider="instagram"
      createdAt={new Date(Date.now() - 10_000).toISOString()}
    />
  ));
  expect(screen.getByRole('status', { name: 'Still sending…' })).toBeTruthy();
});
