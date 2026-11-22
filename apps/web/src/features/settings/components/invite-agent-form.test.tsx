import type { CreateTeamAgent } from '@service-auth/team-agents';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AddAgentState } from '../core/team-agent-add';
import { AGENT_COMPUTER_CHOICE, InviteAgentForm } from './invite-agent-form';
import { TeammateTrustWarning } from './teammate-host-picker';

beforeEach(() => {
  // jsdom has no scrolling; the form brings its notices into view.
  Element.prototype.scrollIntoView = vi.fn();
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

it('offers your computers in the same choice as the sizes, and adds on one without buying', () => {
  const onSubmit = vi.fn();
  const onSubmitHost = vi.fn();
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
      onSubmitHost={onSubmitHost}
      onRetryStart={noop}
      onEdit={noop}
      onBilling={noop}
      hosts={(choice) => (
        <label>
          <input
            type="radio"
            name={AGENT_COMPUTER_CHOICE}
            checked={choice.selected() === 'harness-1'}
            onChange={() =>
              choice.onSelect({ harnessId: 'harness-1', name: 'my-laptop' })
            }
          />
          my-laptop
        </label>
      )}
      hostNotice={(host) => <p>Runs on {host.name}</p>}
    />
  ));
  fireEvent.input(screen.getByRole('textbox', { name: 'Name it' }), {
    target: { value: 'Ada' },
  });
  expect(screen.getByText('Buy a computer')).toBeTruthy();
  expect(screen.getByText('Your computers')).toBeTruthy();
  const standard = screen.getByRole('radio', { name: 'Standard' });
  const laptop = screen.getByRole('radio', { name: 'my-laptop' });
  expect((standard as HTMLInputElement).checked).toBe(true);
  expect(standard.getAttribute('name')).toBe(laptop.getAttribute('name'));

  fireEvent.click(laptop);
  expect((standard as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText('Runs on my-laptop')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add Ada on my-laptop' }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onSubmitHost).toHaveBeenCalledWith({
    name: 'Ada',
    jobDescription: '',
    personality: '',
    avatarUrl: null,
    purchaseKey: 'example',
    harnessId: 'harness-1',
  });

  // Picking a size again leaves the computer, and Add buys that size.
  fireEvent.click(standard);
  expect(screen.queryByText('Runs on my-laptop')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Add Ada · $40.00/month' })
  );
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it('shows more options under the computer list, held while adding', () => {
  const noop = () => {};
  const [state, setState] = createSignal<AddAgentState>({ kind: 'editing' });
  render(() => (
    <InviteAgentForm
      offers={[]}
      offersFailed={false}
      onRetryOffers={noop}
      state={state()}
      purchaseKey="example"
      onCancel={noop}
      onSubmit={noop}
      onRetryStart={noop}
      onEdit={noop}
      onBilling={noop}
      options={
        <label>
          <input type="checkbox" />
          Give it an email address
        </label>
      }
    />
  ));
  const option = screen.getByRole('checkbox', {
    name: 'Give it an email address',
  });
  expect(option.matches(':disabled')).toBe(false);
  setState({ kind: 'adding' });
  expect(option.matches(':disabled')).toBe(true);
});

it('shows one error and no Add when neither the sizes nor the computers load', () => {
  const noop = () => {};
  const retryOffers = vi.fn();
  const retryHosts = vi.fn();
  render(() => (
    <InviteAgentForm
      offers={undefined}
      offersFailed
      onRetryOffers={retryOffers}
      hostsFailed
      onRetryHosts={retryHosts}
      state={{ kind: 'editing' }}
      purchaseKey="example"
      onCancel={noop}
      onSubmit={noop}
      onRetryStart={noop}
      onEdit={noop}
      onBilling={noop}
      hosts={() => <p>Couldn't list your computers.</p>}
    />
  ));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByText("Couldn't load computers.")).toBeTruthy();
  expect(screen.queryByText("Couldn't list your computers.")).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Add Agent' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retryOffers).toHaveBeenCalledTimes(1);
  expect(retryHosts).toHaveBeenCalledTimes(1);
});

it('names the agent in the trust warning once it has a name', () => {
  render(() => <TeammateTrustWarning host="demo-laptop" name="" />);
  expect(
    screen.getByText(
      'Anything running as you on demo-laptop can act as this agent'
    )
  ).toBeTruthy();
  cleanup();
  render(() => <TeammateTrustWarning host="demo-laptop" name="Ada" />);
  expect(
    screen.getByText('Anything running as you on demo-laptop can act as Ada')
  ).toBeTruthy();
});
