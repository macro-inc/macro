import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { TimerControl } from './timer-control';

afterEach(cleanup);

it('reads Start timer alone in the popover row', () => {
  const onStart = vi.fn();
  render(() => (
    <TimerControl
      variant="row"
      running={false}
      seconds={0}
      onStart={onStart}
      onStop={vi.fn()}
    />
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  expect(onStart).toHaveBeenCalledOnce();
  expect(screen.queryByText('Now')).toBeNull();
});
