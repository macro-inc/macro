import type { CreateTeamAgent } from '@service-auth/team-agents';
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
});

it('does not invite an agent after its picture finishes uploading to a disposed form', async () => {
  const upload = Promise.withResolvers<Partial<CreateTeamAgent>>();
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
      prepareAvatar={() => upload.promise}
    />
  ));
  fireEvent.input(screen.getByRole('textbox', { name: 'Name it' }), {
    target: { value: 'Ada' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Add Ada · $40.00/month' })
  );
  view.unmount();
  upload.resolve({ avatarUrl: null });
  await upload.promise;
  expect(onSubmit).not.toHaveBeenCalled();
});

it('says every size is sold out when Add is pressed with none for sale', () => {
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  const onSubmit = vi.fn();
  const prepareAvatar = vi.fn();
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
      prepareAvatar={prepareAvatar}
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
  expect(prepareAvatar).not.toHaveBeenCalled();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});
