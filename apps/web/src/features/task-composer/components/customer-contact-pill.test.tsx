import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomerContactPill } from './customer-contact-pill';

const state = vi.hoisted(() => ({ allowed: (): boolean => true }));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => state.allowed(),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({ useList: () => ({ items: () => [] }) }),
}));
vi.mock('@property', () => ({
  Property: {
    Root: (props: {
      children: (shown: () => object) => JSX.Element;
      property: object;
    }) => props.children(() => props.property),
    Tooltip: (props: ParentProps) => props.children,
    Pill: (props: ParentProps) => <button>{props.children}</button>,
    Text: () => 'Customer / Contact',
    Caret: () => null,
  },
}));
afterEach(cleanup);

it('conceals the customer picker for denied members and unmounts it on revocation', () => {
  const [allowed, setAllowed] = createSignal(false);
  state.allowed = allowed;
  render(() => (
    <CustomerContactPill
      values={{}}
      onChange={() => {}}
      editor={() => <div>Customer picker</div>}
    />
  ));
  expect(
    screen.queryByRole('button', { name: 'Customer / Contact' })
  ).toBeNull();
  setAllowed(true);
  expect(
    screen.getByRole('button', { name: 'Customer / Contact' })
  ).toBeTruthy();
  setAllowed(false);
  expect(
    screen.queryByRole('button', { name: 'Customer / Contact' })
  ).toBeNull();
  expect(screen.queryByText('Customer picker')).toBeNull();
});
