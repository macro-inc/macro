import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { LabelsMenuPill } from './LabelPill';

const LARKSPUR = {
  id: 'larkspur',
  name: 'Larkspur',
  fullName: 'Customers / Larkspur',
};
const ORDERS = { id: 'orders', name: 'Orders', fullName: 'Orders' };

describe('LabelsMenuPill', () => {
  it('counts the labels and lists their whole names when opened', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(() => <LabelsMenuPill labels={[LARKSPUR, ORDERS]} />);
    const pill = screen.getByRole('button', { name: '2 Labels' });
    expect(screen.queryByRole('menu')).toBeNull();

    await fireEvent.keyDown(pill, { key: 'Enter' });

    const items = screen
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toEqual(['Customers / Larkspur', 'Orders']);
  });

  it('shows a sole label by its own name', () => {
    render(() => <LabelsMenuPill labels={[LARKSPUR]} />);
    expect(screen.getByRole('button', { name: 'Larkspur' })).toBeTruthy();
  });

  it('draws nothing without labels', () => {
    const { container } = render(() => <LabelsMenuPill labels={[]} />);
    expect(container.textContent).toBe('');
  });
});
