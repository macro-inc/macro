import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { AddPipelineRecordDialog } from './add-pipeline-record';

const crm = vi.hoisted(() => ({
  createCompany: vi.fn(async (_input: { name: string; domain?: string }) => ({
    id: 'new-company',
  })),
  createContact: vi.fn(),
}));
vi.mock('./use-crm', () => ({
  useCreateCompanyMutation: () => ({ mutateAsync: crm.createCompany }),
  useCreateContactMutation: () => ({ mutateAsync: crm.createContact }),
  useQuickAccessCrmCompaniesQuery: () => ({
    companies: () => [
      { id: 'acme', name: 'Acme', domains: [{ domain: 'acme.com' }] },
    ],
    query: { isLoading: false },
  }),
  useQuickAccessCrmContactsQuery: () => ({
    contacts: () => [],
    query: { isLoading: false },
  }),
}));

const columns: DatabaseViewColumn[] = [
  {
    id: 'company',
    name: 'Company',
    dataType: 'ENTITY',
    specificEntityType: 'COMPANY',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'stage',
    name: 'Stage',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    options: [
      { id: 'lead', label: 'Lead', color: null },
      { id: 'won', label: 'Won', color: null },
    ],
    writable: true,
  },
  {
    id: 'amount',
    name: 'Amount',
    dataType: 'NUMBER',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
];

function setup(required = false, currentColumns = () => columns) {
  const onCreate = vi.fn(async () => true);
  const onClose = vi.fn();
  render(() => (
    <AddPipelineRecordDialog
      pipeline={{ name: 'Sales', recordType: 'company' }}
      columns={currentColumns()}
      initialValues={{ stage: 'Won' }}
      requirements={
        required
          ? [{ columnId: 'stage', optionId: 'won', fields: ['amount'] }]
          : []
      }
      onCreate={onCreate}
      onClose={onClose}
    />
  ));
  return { onCreate, onClose };
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('AddPipelineRecordDialog', () => {
  it('follows a renamed stage identity and refuses a deleted selected stage', async () => {
    const [current, setCurrent] = createSignal(columns);
    const { onCreate } = setup(true, current);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Find or add a company' }),
      'acme'
    );
    await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
    setCurrent((before) =>
      before.map((column) =>
        column.id === 'stage'
          ? {
              ...column,
              options: column.options.map((option) =>
                option.id === 'won'
                  ? { ...option, label: 'Negotiation' }
                  : option
              ),
            }
          : column
      )
    );
    expect(
      screen.getByRole('button', { name: /Stage:/ }).textContent
    ).toContain('Negotiation');
    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    expect(screen.getByRole('alert').textContent).toContain('Amount');
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Edit Amount' }), {
      target: { value: '100' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit Amount' }), {
      key: 'Enter',
    });
    setCurrent((before) =>
      before.map((column) =>
        column.id === 'stage' ? { ...column, options: [] } : column
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      'Stage option was deleted'
    );
    expect(onCreate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /Amount/ }).textContent
    ).toContain('100');
    // Deleting the entire field removes its stale value but keeps other edits.
    setCurrent((before) => before.filter((column) => column.id !== 'stage'));
    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ values: { company: 'acme', amount: 100 } })
      )
    );
  });

  it('preserves the draft after missing stage fields and submits after they are filled', async () => {
    const { onCreate, onClose } = setup(true);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Find or add a company' }),
      'acme'
    );
    await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    expect(screen.getByRole('alert').textContent).toContain('Amount');
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('acme.com')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    const input = screen.getByRole('textbox', { name: 'Edit Amount' });
    fireEvent.input(input, { target: { value: '0' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          values: { company: 'acme', stage: 'Won', amount: 0 },
        })
      )
    );
  });

  it('waits for a company, then creates one row with the lane stage and every field', async () => {
    const { onCreate, onClose } = setup();
    const submit = screen.getByRole('button', { name: /^Add deal/ });
    expect(submit).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /Stage: Won/ })).toBeTruthy();

    await userEvent.type(
      screen.getByRole('combobox', { name: 'Find or add a company' }),
      'acm'
    );
    await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
    expect(screen.getByText('acme.com')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    const amount = screen.getByRole('textbox', { name: 'Edit Amount' });
    fireEvent.input(amount, { target: { value: '5000' } });
    fireEvent.keyDown(amount, { key: 'Enter' });

    expect(submit).toHaveProperty('disabled', false);
    fireEvent.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      values: { company: 'acme', stage: 'Won', amount: 5000 },
      open: false,
      intentId: expect.stringMatching(/^pipeline-record:/),
      option: undefined,
    });
  });

  it('keeps a field still being edited when the form submits', async () => {
    const { onCreate } = setup();
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Find or add a company' }),
      'acme'
    );
    await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Edit Amount' }),
      '750'
    );
    fireEvent.submit(screen.getByRole('form', { name: /^Add deal/ }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          values: { company: 'acme', stage: 'Won', amount: 750 },
        })
      )
    );
  });

  it('creates a new select option with the row', async () => {
    const { onCreate } = setup();
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Find or add a company' }),
      'acme'
    );
    await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
    await userEvent.click(screen.getByRole('button', { name: /Stage: Won/ }));
    await userEvent.type(
      await screen.findByRole('combobox', { name: 'Search Stage options' }),
      'Negotiation'
    );
    await userEvent.click(await screen.findByText('Create “Negotiation”'));
    expect(
      screen.getByRole('button', { name: /Stage: Negotiation/ })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          values: { company: 'acme', stage: 'Negotiation' },
          option: 'Negotiation',
        })
      )
    );
  });

  it('creates a company searched by domain before its row, and keeps it on a retry', async () => {
    const { onCreate, onClose } = setup();
    onCreate.mockResolvedValueOnce(false);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Find or add a company' }),
      'globex.com'
    );
    await userEvent.click(
      await screen.findByRole('option', { name: 'Add company “globex.com”' })
    );
    expect(
      screen.getByRole('textbox', { name: 'Company name' })
    ).toHaveProperty('value', 'Globex');
    expect(screen.getByRole('textbox', { name: 'Domain' })).toHaveProperty(
      'value',
      'globex.com'
    );

    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not add this deal. Try again.'
    );
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(crm.createCompany).toHaveBeenCalledExactlyOnceWith({
      name: 'Globex',
      domain: 'globex.com',
    });
    const [first, second] = onCreate.mock.calls as unknown as [
      { values: object; intentId: string },
      { values: object; intentId: string },
    ][];
    expect(first[0].values).toEqual({ company: 'new-company', stage: 'Won' });
    expect(second[0]).toEqual(first[0]);
  });

  it('explains a new company it cannot save instead of submitting it', async () => {
    const { onCreate } = setup();
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Find or add a company' }),
      'Initech'
    );
    await userEvent.click(
      await screen.findByRole('option', { name: 'Add company “Initech”' })
    );
    fireEvent.input(screen.getByRole('textbox', { name: 'Domain' }), {
      target: { value: 'https://invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Enter a valid domain like acme.com'
    );
    expect(crm.createCompany).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

it('starts a deal Open in USD and submits an explicitly chosen outcome and currency', async () => {
  const onCreate = vi.fn(async () => true);
  const onClose = vi.fn();
  const commercial: DatabaseViewColumn[] = [
    ...columns,
    {
      id: 'outcome',
      name: 'Outcome',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      writable: true,
      fixedOptions: true,
      defaultValue: 'Open',
      options: [
        { id: 'open', label: 'Open', color: null },
        { id: 'lost', label: 'Lost', color: null },
      ],
    },
    {
      id: 'currency',
      name: 'Amount currency',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      writable: true,
      fixedOptions: true,
      defaultValue: 'USD',
      options: [
        { id: 'usd', label: 'USD', color: null },
        { id: 'eur', label: 'EUR', color: null },
      ],
    },
  ];
  render(() => (
    <AddPipelineRecordDialog
      pipeline={{ name: 'Sales', recordType: 'company' }}
      columns={commercial}
      initialValues={{ amount: 50 }}
      onCreate={onCreate}
      onClose={onClose}
    />
  ));
  await userEvent.type(
    screen.getByRole('combobox', { name: 'Find or add a company' }),
    'acme'
  );
  await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
  await userEvent.click(screen.getByRole('button', { name: /Outcome: Open/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'Lost' }));
  await userEvent.click(
    screen.getByRole('button', { name: /Amount currency: USD/ })
  );
  await userEvent.click(await screen.findByRole('option', { name: 'EUR' }));
  await userEvent.click(screen.getByRole('button', { name: /^Add deal/ }));
  await waitFor(() =>
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          company: 'acme',
          amount: 50,
          outcome: 'Lost',
          currency: 'EUR',
        },
      })
    )
  );
});
