/**
 * @vitest-environment jsdom
 */

import type { SizeOffer } from '@service-auth/computers';
import { render, screen } from '@solidjs/testing-library';
import { expect, it } from 'vitest';
import { ComputerSizePicker } from './computer-size-picker';

const standard: SizeOffer = {
  size: 'standard',
  vcpus: 2,
  memoryGb: 8,
  diskGb: 64,
  quote: {
    size: 'standard',
    priceId: 'price_standard',
    amount: 4000,
    currency: 'usd',
    interval: 'month',
  },
  soldOut: false,
};

it('lists only the sizes offered', () => {
  render(() => (
    <ComputerSizePicker
      offers={[standard]}
      selected="standard"
      onSelect={() => {}}
    />
  ));

  expect(screen.getAllByRole('radio')).toHaveLength(1);
  expect(
    screen.queryByText('No computer sizes are available right now.')
  ).toBeNull();
});

it('says no sizes are available when none are offered', () => {
  render(() => (
    <ComputerSizePicker offers={[]} selected={undefined} onSelect={() => {}} />
  ));

  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(
    screen.getByText('No computer sizes are available right now.')
  ).toBeTruthy();
});
