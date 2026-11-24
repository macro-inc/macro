import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InviteAgentForm } from './invite-agent-form';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // jsdom has no scrollIntoView; a test that stubs it removes it here.
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

it('shows the first letter of the name as the picture, and adds the agent with that name and size', () => {
  const onSubmit = vi.fn();
  const noop = () => {};
  const view = render(() => (
    <InviteAgentForm
      offers={[
        {
          size: 'standard',
          vcpus: 4,
          memoryGb: 8,
          diskGb: 100,
          soldOut: false,
          quote: {
            size: 'standard',
            amount: 4000,
            currency: 'usd',
            interval: 'month',
            priceId: 'price_standard',
          },
        },
      ]}
      offersFailed={false}
      onRetryOffers={noop}
      state={{ kind: 'editing' }}
      purchaseKey="example"
      onCancel={noop}
      onSubmit={onSubmit}
      onRetryStart={noop}
      onEdit={noop}
      onBilling={noop}
    />
  ));
  const name = screen.getByRole('textbox', { name: 'Name it' });
  const picture = () =>
    view.container.querySelector('[data-slot="avatar"]')?.textContent;
  expect(picture()).toBe('?');
  // What Add charges for is said before anything is bought.
  expect(
    screen.getByText('Its own computer, always on. Its seat is included.')
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Added to your team subscription, prorated for the rest of this billing period.'
    )
  ).toBeTruthy();

  fireEvent.input(name, { target: { value: 'ada' } });
  expect(picture()).toBe('A');
  // One letter, however many words the name has.
  fireEvent.input(name, { target: { value: 'Ada Lovelace' } });
  expect(picture()).toBe('A');
  // Renaming redraws it.
  fireEvent.input(name, { target: { value: '  Émile' } });
  expect(picture()).toBe('É');
  // A letter outside the BMP stays whole.
  fireEvent.input(name, { target: { value: '𝓩ed' } });
  expect(picture()).toBe('𝓩');
  fireEvent.input(name, { target: { value: '👩‍💻 Dev' } });
  expect(picture()).toBe('👩‍💻');
  fireEvent.input(name, { target: { value: '小明' } });
  expect(picture()).toBe('小');

  fireEvent.click(
    screen.getByRole('button', { name: 'Add 小明 · $40.00/month' })
  );
  expect(onSubmit).toHaveBeenCalledWith(
    {
      name: '小明',
      jobDescription: '',
      personality: '',
      size: 'standard',
      avatarUrl: null,
      purchaseKey: 'example',
    },
    'standard'
  );
});

it('marks the name instead of adding when it is empty', () => {
  const onSubmit = vi.fn();
  const noop = () => {};
  render(() => (
    <InviteAgentForm
      offers={[
        {
          size: 'standard',
          vcpus: 4,
          memoryGb: 8,
          diskGb: 100,
          soldOut: false,
          quote: {
            size: 'standard',
            amount: 4000,
            currency: 'usd',
            interval: 'month',
            priceId: 'price_standard',
          },
        },
      ]}
      offersFailed={false}
      onRetryOffers={noop}
      state={{ kind: 'editing' }}
      purchaseKey="example"
      onCancel={noop}
      onSubmit={onSubmit}
      onRetryStart={noop}
      onEdit={noop}
      onBilling={noop}
    />
  ));
  const name = screen.getByRole('textbox', { name: 'Name it' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Add Agent · $40.00/month' })
  );
  expect(onSubmit).not.toHaveBeenCalled();
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText('Give your agent a name to continue.')).toBeTruthy();
  expect(document.activeElement).toBe(name);
});

it('says every size is sold out when Add is pressed with none for sale', () => {
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  const onSubmit = vi.fn();
  const noop = () => {};
  render(() => (
    <InviteAgentForm
      offers={[
        {
          size: 'standard',
          vcpus: 4,
          memoryGb: 8,
          diskGb: 100,
          soldOut: true,
          quote: {
            size: 'standard',
            amount: 4000,
            currency: 'usd',
            interval: 'month',
            priceId: 'price_standard',
          },
        },
      ]}
      offersFailed={false}
      onRetryOffers={noop}
      state={{ kind: 'editing' }}
      purchaseKey="example"
      onCancel={noop}
      onSubmit={onSubmit}
      onRetryStart={noop}
      onEdit={noop}
      onBilling={noop}
    />
  ));
  fireEvent.input(screen.getByRole('textbox', { name: 'Name it' }), {
    target: { value: 'Ada' },
  });
  expect(
    screen.queryByText(
      'Every computer size is sold out right now. Try again later.'
    )
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add Ada' }));
  expect(
    screen.getByText(
      'Every computer size is sold out right now. Try again later.'
    )
  ).toBeTruthy();
  expect(scrolled).toHaveBeenCalled();
  expect(onSubmit).not.toHaveBeenCalled();
});
