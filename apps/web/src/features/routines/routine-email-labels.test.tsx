import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RoutineEmailLabels,
  RoutineEmailLabelsLabel,
} from './routine-email-labels';

const label = (id: string, linkId: string, name: string) => ({
  id,
  linkId,
  name,
  type: 'User',
  labelListVisibility: 'label_show',
  messageListVisibility: 'show',
});

vi.mock('@queries/email/labels', () => ({
  useEmailUserLabelsQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      labels: [
        label('invoices', 'gmail', 'Finance/Invoices'),
        label('finance', 'gmail', 'Finance'),
        label('board-gmail', 'gmail', 'Board'),
        label('board-outlook', 'outlook', 'Board'),
        label('slash', 'outlook', 'Q4/Planning'),
        { ...label('inbox', 'gmail', 'INBOX'), type: 'System' },
      ],
    },
  }),
}));

vi.mock('@queries/email/mail-accounts', () => ({
  useMailAccountsQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      links: [
        { id: 'gmail', email_address: 'sam@acme.example', provider: 'GMAIL' },
        {
          id: 'outlook',
          email_address: 'rivera@northwind.example',
          provider: 'OUTLOOK',
        },
      ],
    },
  }),
}));

function mount(initial: string[] = []) {
  const [labels, setLabels] = createSignal(initial);
  render(() => (
    <>
      <RoutineEmailLabels labels={labels()} onChange={setLabels} />
      <output role="status">
        <RoutineEmailLabelsLabel labels={labels()} />
      </output>
    </>
  ));
  return labels;
}

describe('RoutineEmailLabels', () => {
  afterEach(cleanup);

  it('chooses labels by id, so equal names in two inboxes stay apart', () => {
    const labels = mount();
    expect(
      screen
        .getByRole('button', { name: 'Any label' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Any label');

    fireEvent.click(screen.getByRole('button', { name: 'Choose labels' }));
    expect(screen.getByText('sam@acme.example')).toBeTruthy();
    expect(screen.getByText('rivera@northwind.example')).toBeTruthy();
    const boards = screen.getAllByRole('checkbox', { name: 'Board' });
    expect(boards).toHaveLength(2);
    fireEvent.click(boards[1]);
    expect(labels()).toEqual(['board-outlook']);

    // A Gmail label nests under the label its name starts with; an Outlook
    // category with a slash is one category.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Invoices' }));
    expect(screen.getByRole('checkbox', { name: 'Q4/Planning' })).toBeTruthy();
    // Gmail's own labels name views and states, not labels people made.
    expect(screen.queryByRole('checkbox', { name: 'INBOX' })).toBeNull();
    expect(labels()).toEqual(['board-outlook', 'invoices']);
    expect(screen.getByRole('status').textContent).toBe(
      'Board or Finance / Invoices'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Finance / Invoices' })
    );
    expect(labels()).toEqual(['board-outlook']);
    fireEvent.click(screen.getByRole('button', { name: 'Any label' }));
    expect(labels()).toEqual([]);
  });

  it('searches every inbox by the whole name', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose labels' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Search labels' }), {
      target: { value: 'finance/inv' },
    });
    expect(
      screen.getByRole('checkbox', { name: 'Finance / Invoices' })
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Board' })).toBeNull();

    fireEvent.input(screen.getByRole('textbox', { name: 'Search labels' }), {
      target: { value: 'nothing like it' },
    });
    expect(screen.getByText('No label matches.')).toBeTruthy();
  });

  it('keeps a label it can no longer find, and says so', () => {
    mount(['gone']);
    expect(
      screen.getByRole('button', { name: 'Remove unknown label' })
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 label');
  });
});
