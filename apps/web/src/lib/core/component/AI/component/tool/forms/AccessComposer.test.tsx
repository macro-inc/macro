import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormAccessComposer } from './AccessComposer';
import type { FormAccessArgs } from './types';

const formId = '0199bfee-1000-7000-8000-000000000001';
const detail: FormDetail = {
  access: 'owner',
  tableGone: false,
  form: {
    id: formId,
    name: 'Startup intake',
    description: '',
    ownerId: 'macro|owner@macro.com',
    databaseId: '0199bfee-1000-7000-8000-000000000002',
    tableId: '0199bfee-1000-7000-8000-000000000003',
    audience: 'members',
    status: 'closed',
    tallyVisible: false,
    confirmationMessage: '',
    closesAt: null,
    submittedColumnId: null,
    respondentColumnId: null,
    createdAt: '2026-10-06T12:00:00Z',
    updatedAt: '2026-10-06T12:00:00Z',
  },
  sections: [
    {
      kind: 'questions',
      id: '0199bfee-1000-7000-8000-000000000004',
      title: 'Company',
      description: '',
      questions: [
        {
          id: '0199bfee-1000-7000-8000-000000000005',
          column: '0199bfee-1000-7000-8000-000000000006',
          title: 'Annual revenue',
          kind: { type: 'number' },
          options: [],
          required: true,
          helpText: '',
          widget: null,
        },
      ],
    },
  ],
};
const args: FormAccessArgs = {
  requestId: '0199bfee-1000-7000-8000-000000000007',
  formId,
  baseRevision: '0199bfee-1000-7000-8000-000000000008',
  draft: {
    audience: 'public',
    status: 'open',
    closesAt: null,
    tallyVisible: false,
    channelGrants: [],
  },
};
afterEach(cleanup);
describe('Forms access review', () => {
  it('shows the reviewed questions and submits the whole edited argument object', async () => {
    const execute = vi.fn(async () => true);
    render(() => (
      <FormAccessComposer
        initialData={args}
        detail={detail}
        sink={{
          canAct: () => true,
          lockedNotice: () => undefined,
          onExecute: execute,
          onReject: async () => true,
        }}
      />
    ));
    expect(screen.getByText('Annual revenue (required)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Who can respond'), {
      target: { value: 'members' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save sharing' }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        ...args,
        draft: { ...args.draft, audience: 'members' },
      })
    );
  });
  it('accepts an omitted channel grant list', async () => {
    const execute = vi.fn(async () => true);
    const { channelGrants: _, ...draft } = args.draft;
    render(() => (
      <FormAccessComposer
        initialData={{ ...args, draft }}
        detail={detail}
        sink={{
          canAct: () => true,
          lockedNotice: () => undefined,
          onExecute: execute,
          onReject: async () => true,
        }}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Save sharing' }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(args));
  });
  it('lets a transcript owner decline after losing form ownership', async () => {
    const reject = vi.fn(async () => true);
    const execute = vi.fn(async () => true);
    render(() => (
      <FormAccessComposer
        initialData={args}
        detail={{ ...detail, access: 'edit' }}
        sink={{
          canAct: () => true,
          lockedNotice: () => undefined,
          onExecute: execute,
          onReject: reject,
        }}
      />
    ));
    expect(
      (
        screen.getByRole('button', {
          name: 'Save sharing',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel review' }));
    await waitFor(() => expect(reject).toHaveBeenCalledOnce());
    expect(execute).not.toHaveBeenCalled();
  });
  it('identifies the recipient channel, database consequence and booking destination', () => {
    const target = {
      profileId: '0199bfee-1000-7000-8000-000000000011',
      eventTypeId: '0199bfee-1000-7000-8000-000000000012',
    };
    render(() => (
      <FormAccessComposer
        initialData={{
          ...args,
          draft: {
            ...args.draft,
            channelGrants: [
              {
                operation: 'upsert',
                channelId: '0199bfee-1000-7000-8000-000000000010',
                access: 'edit',
              },
            ],
          },
        }}
        detail={{
          ...detail,
          sections: [
            ...detail.sections,
            {
              kind: 'booking',
              id: '0199bfee-1000-7000-8000-000000000009',
              title: 'Founder call',
              description: '',
              target,
            },
          ],
        }}
        channelNames={
          new Map([
            ['0199bfee-1000-7000-8000-000000000010', 'Startup applications'],
          ])
        }
        booking={{
          title: 'Founder introduction · 30 minutes',
          url: '/app/book/founders/introduction',
        }}
        sink={{
          canAct: () => true,
          lockedNotice: () => undefined,
          onExecute: async () => true,
          onReject: async () => true,
        }}
      />
    ));
    expect(screen.getByText('Startup applications')).toBeTruthy();
    expect(screen.getByText(/entire.*database/)).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Founder introduction · 30 minutes' })
        .getAttribute('href')
    ).toBe('/app/book/founders/introduction');
  });
  it('declines without executing and blocks readers of another owner’s transcript', async () => {
    const execute = vi.fn(async () => true);
    const reject = vi.fn(async () => true);
    const view = render(() => (
      <FormAccessComposer
        initialData={args}
        detail={detail}
        sink={{
          canAct: () => true,
          lockedNotice: () => undefined,
          onExecute: execute,
          onReject: reject,
        }}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel review' }));
    await waitFor(() => expect(reject).toHaveBeenCalledOnce());
    expect(execute).not.toHaveBeenCalled();
    view.unmount();
    render(() => (
      <FormAccessComposer
        initialData={args}
        detail={detail}
        sink={{
          canAct: () => false,
          lockedNotice: () => 'Only the chat owner can finish this review.',
          onExecute: execute,
          onReject: reject,
        }}
      />
    ));
    expect(
      (
        screen.getByRole('button', {
          name: 'Save sharing',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
