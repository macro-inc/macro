import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { PaymentPreview } from './PaymentPreview';

afterEach(cleanup);

it('reveals billing details after a full test number and hides them when cleared', () => {
  const view = render(() => <PaymentPreview />);
  const card = view.getByRole('textbox', { name: 'Card number' });
  const details = [
    'Expiration',
    'Security code',
    'Country or region',
    'ZIP code',
  ];
  for (const label of details) expect(view.queryByText(label)).toBeNull();

  fireEvent.input(card, { target: { value: '4242' } });
  expect(view.queryByText('Expiration')).toBeNull();

  fireEvent.input(card, { target: { value: '4242 4242 4242 4242' } });
  for (const label of details) expect(view.getByText(label)).toBeTruthy();

  fireEvent.input(card, { target: { value: '' } });
  for (const label of details) expect(view.queryByText(label)).toBeNull();
});
