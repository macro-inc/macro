import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import {
  createSignal,
  ErrorBoundary,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmContact } from '../core/contact';
import { CrmCompanyDetail } from './record-detail';

vi.mock('@ui', async () => ({
  ...(await import('../../../components/ui/utils/classname')),
  Tooltip: (props: ParentProps) => <>{props.children}</>,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Root: (props: ParentProps) => <>{props.children}</>,
    Toggle: () => null,
  },
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('./copy-link-button', () => ({ CrmCopyLinkButton: () => null }));
vi.mock('../components/record-tabs', () => ({ RecordTabs: () => null }));
vi.mock('./use-crm', () => ({
  useCompanyQuery: () => ({
    query: { isError: false },
    company: () => undefined,
  }),
  useContactQuery: () => ({ isSuccess: false, isError: false }),
}));
vi.mock('./company-detail', () => ({
  Company: (props: { onOpenContact(contact: CrmContact): void }) => (
    <button
      onClick={() =>
        props.onOpenContact({
          id: 'contact-1',
          companyId: 'company-1',
          name: 'Maya',
          email: 'maya@company.com',
          hidden: false,
          firstInteraction: '',
          lastInteraction: '',
          createdAt: '',
          updatedAt: '',
        })
      }
    >
      Open Maya
    </button>
  ),
}));
vi.mock('./contact-detail', () => ({
  Contact: (props: { contactId: string }) => (
    <div>Contact content: {props.contactId}</div>
  ),
}));
afterEach(cleanup);

it('removes contact breadcrumbs safely when returning to the company and reopening details', () => {
  const failed = vi.fn(() => <div>Navigation failed</div>);
  const [selected, setSelected] = createSignal(true);
  render(() => (
    <ErrorBoundary fallback={failed}>
      <Show
        when={selected()}
        fallback={
          <button onClick={() => setSelected(true)}>Open company</button>
        }
      >
        <CrmCompanyDetail
          company={{ id: 'company-1', name: 'Northstar' }}
          viewName="Pipeline"
          onClose={() => setSelected(false)}
          navigation={null}
        />
      </Show>
    </ErrorBoundary>
  ));
  for (let round = 0; round < 2; round++) {
    fireEvent.click(screen.getByRole('button', { name: 'Open Maya' }));
    const breadcrumbs = () =>
      within(screen.getByRole('navigation', { name: 'CRM record location' }));
    expect(breadcrumbs().getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('Contact content: contact-1')).toBeTruthy();
    fireEvent.click(breadcrumbs().getByRole('button', { name: 'Northstar' }));
    expect(failed).not.toHaveBeenCalled();
    expect(breadcrumbs().getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Open Maya' })).toBeTruthy();
    fireEvent.click(breadcrumbs().getByRole('button', { name: 'Pipeline' }));
    expect(
      screen.queryByRole('navigation', { name: 'CRM record location' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open company' }));
  }
  expect(failed).not.toHaveBeenCalled();
});
