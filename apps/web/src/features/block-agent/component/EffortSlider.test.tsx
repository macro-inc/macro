/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { SelectSessionConfigOption } from '../state/session-config';
import { EffortSlider } from './EffortSlider';

const config: SelectSessionConfigOption = {
  id: 'effort',
  name: 'Effort',
  category: 'thought_level',
  description: null,
  type: 'select',
  currentValue: 'low',
  options: [
    { name: 'Low', value: 'low', group: null, description: null },
    { name: 'High', value: 'high', group: null, description: null },
  ],
};
afterEach(cleanup);
it('previews while dragging and commits the opaque setting on release', () => {
  const change = vi.fn();
  render(() => <EffortSlider config={config} onChange={change} />);
  const slider = screen.getByRole('slider');
  fireEvent.input(slider, { target: { value: '1' } });
  expect(slider.getAttribute('aria-valuetext')).toBe('High');
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(slider, { target: { value: '1' } });
  expect(change).toHaveBeenCalledExactlyOnceWith({
    configId: 'effort',
    value: 'high',
    name: 'High',
  });
});
it('hides unsupported effort and guards disabled changes', () => {
  const change = vi.fn();
  const { unmount } = render(() => <EffortSlider onChange={change} />);
  expect(screen.queryByRole('slider')).toBeNull();
  unmount();
  render(() => <EffortSlider config={config} disabled onChange={change} />);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } });
  expect(change).not.toHaveBeenCalled();
});
