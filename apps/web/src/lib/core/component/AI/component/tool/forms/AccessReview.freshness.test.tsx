import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { FormAccessArgs } from './types';

let fetchDetail: () => Promise<FormDetail>;
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@queries/storage/forms', () => ({
  formDetailQueryOptions: (id: string) => ({
    queryKey: ['forms', 'detail', id],
    queryFn: () => fetchDetail(),
    staleTime: 30_000,
  }),
}));
vi.mock('@queries/channel/channels', () => ({
  useListChannelsQuery: () => ({ isSuccess: false }),
}));
vi.mock('@app/features/block-form/queries/booking-sources', () => ({
  createBookingEventSource: () => ({ value: () => undefined }),
}));
vi.mock('@app/features/scheduling/scheduling', () => ({
  schedulingLink: () => '/unused',
}));

import { FormAccessReview } from './AccessReview';

const args: FormAccessArgs = {
  formId: '0199bfee-1000-7000-8000-000000000002',
  baseRevision: '0199bfee-1000-7000-8000-000000000003',
  draft: {
    audience: 'public',
    status: 'open',
    tallyVisible: false,
    channelGrants: [],
  },
};
const old: FormDetail = {
  access: 'owner',
  tableGone: false,
  form: {
    id: args.formId,
    name: 'Old cached form',
    description: '',
    ownerId: 'macro|owner@macro.com',
    databaseId: '0199bfee-1000-7000-8000-000000000004',
    tableId: '0199bfee-1000-7000-8000-000000000005',
    status: 'closed',
    audience: 'members',
    tallyVisible: false,
    confirmationMessage: '',
    closesAt: null,
    submittedColumnId: null,
    respondentColumnId: null,
    createdAt: '2026-10-06T12:00:00Z',
    updatedAt: '2026-10-06T12:00:00Z',
  },
  sections: [],
};
afterEach(cleanup);
it('withholds acceptance of warm cached details until the reviewed request loads current contents', async () => {
  let resolve: (detail: FormDetail) => void = () => {
    throw new Error('fetch not started');
  };
  fetchDetail = vi.fn(
    () =>
      new Promise<FormDetail>((done) => {
        resolve = done;
      })
  );
  const execute = vi.fn(async () => true);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    ['forms', 'detail', args.formId, 'access-review', args.baseRevision],
    old
  );
  render(() => (
    <QueryClientProvider client={client}>
      <FormAccessReview
        initialData={args}
        sink={{
          canAct: () => true,
          lockedNotice: () => undefined,
          onExecute: execute,
          onReject: async () => true,
        }}
      />
    </QueryClientProvider>
  ));
  await waitFor(() => expect(fetchDetail).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', { name: 'Save sharing' })).toBeNull();
  expect(screen.queryByText('Share Old cached form')).toBeNull();
  resolve({ ...old, form: { ...old.form, name: 'Current reviewed form' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save sharing' })).toBeTruthy()
  );
  expect(screen.getByText('Share Current reviewed form')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Who can respond'), {
    target: { value: 'members' },
  });
  const control = screen.getByLabelText('Who can respond');
  void client.invalidateQueries({ queryKey: ['forms', 'detail', args.formId] });
  await waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(2));
  expect(control.isConnected).toBe(true);
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Save sharing',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  );
  resolve({ ...old, form: { ...old.form, name: 'Refreshed reviewed form' } });
  await waitFor(() =>
    expect(screen.getByText('Share Refreshed reviewed form')).toBeTruthy()
  );
  expect(
    (screen.getByLabelText('Who can respond') as HTMLSelectElement).value
  ).toBe('members');
  fireEvent.click(screen.getByRole('button', { name: 'Save sharing' }));
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith({
      ...args,
      draft: { ...args.draft, audience: 'members' },
    })
  );
  client.clear();
});
