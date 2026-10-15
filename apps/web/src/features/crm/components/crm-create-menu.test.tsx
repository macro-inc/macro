import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CrmCreateMenu } from './crm-create-menu';

vi.mock('@app/components/view-shell', () => ({ ViewSidebar: {} }));
afterEach(cleanup);

it.each(['Company', 'Contact', 'Pipeline'])(
  'keeps %s creation available from the toolbar menu',
  async (name) => {
    const company = vi.fn();
    const contact = vi.fn();
    const pipeline = vi.fn();
    render(() => (
      <CrmCreateMenu
        presentation="toolbar"
        record="company"
        onCreateCompany={company}
        onCreateContact={contact}
        pipeline={{ disabled: false, onCreate: pipeline }}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Create CRM record' }),
      {
        key: 'Enter',
      }
    );
    await screen.findByRole('menu');
    fireEvent.keyDown(screen.getByRole('menuitem', { name }), {
      key: 'Enter',
    });
    expect(company).toHaveBeenCalledTimes(name === 'Company' ? 1 : 0);
    expect(contact).toHaveBeenCalledTimes(name === 'Contact' ? 1 : 0);
    expect(pipeline).toHaveBeenCalledTimes(name === 'Pipeline' ? 1 : 0);
  }
);

it('preserves disabled pipeline creation', async () => {
  const pipeline = vi.fn();
  render(() => (
    <CrmCreateMenu
      presentation="toolbar"
      onCreateCompany={vi.fn()}
      onCreateContact={vi.fn()}
      pipeline={{ disabled: true, onCreate: pipeline }}
    />
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Create CRM record' }), {
    key: 'Enter',
  });
  await screen.findByRole('menu');
  const option = screen.getByRole('menuitem', {
    name: 'Pipeline',
  });
  expect(option.getAttribute('aria-disabled')).toBe('true');
  fireEvent.keyDown(option, { key: 'Enter' });
  expect(pipeline).not.toHaveBeenCalled();
});
