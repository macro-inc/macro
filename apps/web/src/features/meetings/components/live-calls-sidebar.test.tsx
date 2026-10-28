import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveCallsSidebar } from './live-calls-sidebar';

afterEach(cleanup);

it('offers Open for a call the user is in and Join for the rest', async () => {
  const onSelect = vi.fn();
  render(() => (
    <LiveCallsSidebar
      calls={[
        { id: 'in', label: 'design', joined: true },
        { id: 'out', label: 'standup', joined: false },
      ]}
      onSelect={onSelect}
    />
  ));

  await userEvent.click(screen.getByRole('button', { name: 'Open design' }));
  expect(onSelect).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'in' })
  );

  await userEvent.click(screen.getByRole('button', { name: 'Join standup' }));
  expect(onSelect).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'out' })
  );
});

it('renders nothing without live calls', () => {
  render(() => <LiveCallsSidebar calls={[]} onSelect={vi.fn()} />);
  expect(screen.queryByText('Live')).toBeNull();
});
