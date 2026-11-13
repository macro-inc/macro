import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationStacksProvider,
  type StacksState,
} from '../context/notification-stacks-context';
import { fakeStacksContext, rule, supportStack } from '../tests/stacks';
import { StacksSection } from './stacks-section';

const openStackEditor = vi.hoisted(() => vi.fn());
vi.mock('./stack-editor-dialog', () => ({ openStackEditor }));

const setup = (state: StacksState) => {
  const fake = fakeStacksContext(state);
  render(() => (
    <NotificationStacksProvider value={fake.context}>
      <StacksSection />
    </NotificationStacksProvider>
  ));
  return fake;
};

afterEach(() => vi.clearAllMocks());

describe('StacksSection', () => {
  it('lists each stack with what it does and whether it is on', () => {
    setup({
      t: 'ready',
      stacks: [
        supportStack(),
        supportStack({ id: 'stack-2', name: 'Bots', enabled: false }),
      ],
    });

    expect(screen.getByText('Support channels')).toBeTruthy();
    expect(
      screen.getAllByText('Channels named “support” · Lets Mentions through')
    ).toHaveLength(2);
    const on = screen.getByRole<HTMLInputElement>('switch', {
      name: 'Capture with Support channels',
    });
    const off = screen.getByRole<HTMLInputElement>('switch', {
      name: 'Capture with Bots',
    });
    expect(on.checked).toBe(true);
    expect(off.checked).toBe(false);
  });

  it('says why a stack with rules the editor cannot show has no Edit', () => {
    setup({
      t: 'ready',
      stacks: [
        supportStack({
          capture: [
            rule({ kinds: ['reaction'] }),
            rule({ kinds: ['comment'] }),
          ],
        }),
      ],
    });

    expect(screen.getByText('Custom rules')).toBeTruthy();
    expect(
      screen.getByText(
        'This stack has rules this editor can’t show. You can still turn it off or delete it.'
      )
    ).toBeTruthy();
  });

  it('turns a stack off from its switch', () => {
    const { stacks } = setup({ t: 'ready', stacks: [supportStack()] });

    fireEvent.click(
      screen.getByRole('switch', { name: 'Capture with Support channels' })
    );

    expect(stacks.update).toHaveBeenCalledWith('stack-support', {
      enabled: false,
    });
  });

  it('opens the editor for a new stack', () => {
    setup({ t: 'ready', stacks: [] });

    expect(screen.getByText('No stacks yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New stack' }));

    expect(openStackEditor).toHaveBeenCalledWith({}, expect.anything());
  });

  it('offers a retry when the stacks cannot be read', () => {
    const { stacks } = setup({ t: 'error' });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(stacks.retry).toHaveBeenCalled();
  });

  it('keeps the list in step with the stacks it is given', () => {
    const { setState } = setup({ t: 'loading' });
    expect(screen.getByText('Loading stacks…')).toBeTruthy();

    setState({ t: 'ready', stacks: [supportStack()] });

    expect(screen.getByText('Support channels')).toBeTruthy();
    expect(screen.queryByText('Loading stacks…')).toBeNull();
  });
});
