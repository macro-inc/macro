import type { Form } from '@service-storage/generated/schemas/form';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { renameDatabase } from '../../../features/block-database/queries/rename-database';
import { renameForm } from '../../../features/block-form/queries/form-entity';
import { queryClient } from '../client';
import { previewKeys } from '../preview/keys';
import type { PreviewItem } from '../preview/types';
import { useFormChangedSync } from './forms-sync';
import { databasesKeys, formsKeys } from './keys';

const messages = vi.hoisted(
  () => [] as ((message: { type: string; data: unknown }) => void)[]
);

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('../preview/fetchers', () => ({
  defaultNameTransform: (value: PreviewItem) => value,
  fetchMessageContext: vi.fn(),
  fetchRestPreviewBatch: vi.fn(),
}));
vi.mock('../preview/graphql', () => ({
  isGraphqlPreviewItem: () => false,
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => false,
}));
vi.mock('@service-connection/client', () => ({
  useEntitySubscription: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  createConnectionWebsocketEffect: (
    callback: (message: { type: string; data: unknown }) => void
  ) => messages.push(callback),
}));

afterEach(() => {
  queryClient.clear();
  messages.length = 0;
});

it('updates an already cached card title after renaming a form', async () => {
  const databaseKey = databasesKeys.detail('workshop-database').queryKey;
  queryClient.setQueryData(databaseKey, { name: 'Untitled form' });
  queryClient.setQueryData<FormDetail>(formsKeys.detail('workshop').queryKey, {
    access: 'owner',
    tableGone: false,
    sections: [],
    form: {
      id: 'workshop',
      name: 'Untitled form',
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'workshop-database',
      tableId: 'responses',
      submittedColumnId: null,
      respondentColumnId: null,
      audience: 'members',
      tallyVisible: false,
      status: 'open',
      closesAt: null,
      confirmationMessage: '',
      createdAt: '2026-10-05T00:00:00Z',
      updatedAt: '2026-10-05T00:00:00Z',
    },
  });
  const key = previewKeys.item('workshop').queryKey;
  queryClient.setQueryData<PreviewItem>(key, {
    id: 'workshop',
    type: 'form',
    loading: false,
    access: 'access',
    name: 'Untitled form',
    rawName: 'Untitled form',
    owner: 'macro|owner@example.com',
  });
  const result = await renameForm(
    {
      mutation: () => ({
        toPromise: async () => ({
          data: {
            renameEntities: {
              results: [{ __typename: 'GraphqlMutationSuccess' as const }],
            },
            trashEntities: { results: [] },
          },
        }),
      }),
    },
    'workshop',
    'Workshop ideas'
  );
  expect(result.isOk()).toBe(true);
  expect(queryClient.getQueryData(key)).toMatchObject({
    name: 'Workshop ideas',
    rawName: 'Workshop ideas',
  });
  expect(queryClient.getQueryState(databaseKey)?.isInvalidated).toBe(true);
});

it('refreshes only this form’s card preview when its shared facts change', () => {
  const current = previewKeys.item('workshop').queryKey;
  const other = previewKeys.item('offsite').queryKey;
  queryClient.setQueryData<PreviewItem>(current, {
    id: 'workshop',
    type: 'form',
    loading: false,
    access: 'access',
    name: 'Workshop ideas',
    rawName: 'Workshop ideas',
    owner: 'macro|owner@example.com',
  });
  queryClient.setQueryData<PreviewItem>(other, {
    id: 'offsite',
    type: 'form',
    loading: false,
    access: 'access',
    name: 'Offsite',
    rawName: 'Offsite',
    owner: 'macro|owner@example.com',
  });
  const dispose = createRoot((dispose) => {
    useFormChangedSync(() => 'workshop');
    return dispose;
  });
  messages[0]({ type: 'form_changed', data: { formId: 'offsite' } });
  expect(queryClient.getQueryState(current)?.isInvalidated).toBe(false);
  messages[0]({ type: 'form_changed', data: { formId: 'workshop' } });
  expect(queryClient.getQueryState(current)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
  dispose();
});

it('refreshes the linked database’s card after renaming a form, without guessing its name', async () => {
  queryClient.setQueryData<FormDetail>(formsKeys.detail('workshop').queryKey, {
    access: 'owner',
    tableGone: false,
    sections: [],
    form: {
      id: 'workshop',
      name: 'Untitled form',
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'workshop-database',
      tableId: 'responses',
      submittedColumnId: null,
      respondentColumnId: null,
      audience: 'members',
      tallyVisible: false,
      status: 'open',
      closesAt: null,
      confirmationMessage: '',
      createdAt: '2026-10-05T00:00:00Z',
      updatedAt: '2026-10-05T00:00:00Z',
    },
  });
  const linked = previewKeys.item('workshop-database').queryKey;
  const unrelated = previewKeys.item('budget-database').queryKey;
  queryClient.setQueryData<PreviewItem>(linked, {
    id: 'workshop-database',
    type: 'database',
    loading: false,
    access: 'access',
    name: 'Untitled form',
    rawName: 'Untitled form',
    owner: 'macro|owner@example.com',
  });
  queryClient.setQueryData<PreviewItem>(unrelated, {
    id: 'budget-database',
    type: 'database',
    loading: false,
    access: 'access',
    name: 'Budget',
    rawName: 'Budget',
    owner: 'macro|owner@example.com',
  });

  const result = await renameForm(
    {
      mutation: () => ({
        toPromise: async () => ({
          data: {
            renameEntities: {
              results: [{ __typename: 'GraphqlMutationSuccess' as const }],
            },
            trashEntities: { results: [] },
          },
        }),
      }),
    },
    'workshop',
    'Workshop ideas'
  );

  expect(result.isOk()).toBe(true);
  expect(queryClient.getQueryState(linked)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryData(linked)).toMatchObject({
    rawName: 'Untitled form',
  });
  expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false);
});

it('refreshes the cards of the forms over a renamed database, and only theirs', async () => {
  queryClient.setQueryData<Form[]>(
    formsKeys.forDatabase('workshop-database').queryKey,
    [
      {
        id: 'workshop',
        name: 'Workshop ideas',
        description: '',
        ownerId: 'macro|owner@example.com',
        databaseId: 'workshop-database',
        tableId: 'responses',
        submittedColumnId: null,
        respondentColumnId: null,
        audience: 'members',
        tallyVisible: false,
        status: 'open',
        closesAt: null,
        confirmationMessage: '',
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      },
    ]
  );
  queryClient.setQueryData<ListedForm[]>(formsKeys.list.queryKey, [
    {
      access: 'owner',
      form: {
        id: 'feedback',
        name: 'Session feedback',
        description: '',
        ownerId: 'macro|owner@example.com',
        databaseId: 'workshop-database',
        tableId: 'responses',
        submittedColumnId: null,
        respondentColumnId: null,
        audience: 'members',
        tallyVisible: false,
        status: 'open',
        closesAt: null,
        confirmationMessage: '',
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      },
    },
    {
      access: 'owner',
      form: {
        id: 'offsite',
        name: 'Offsite',
        description: '',
        ownerId: 'macro|owner@example.com',
        databaseId: 'offsite-database',
        tableId: 'responses',
        submittedColumnId: null,
        respondentColumnId: null,
        audience: 'members',
        tallyVisible: false,
        status: 'open',
        closesAt: null,
        confirmationMessage: '',
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      },
    },
  ]);
  const workshop = previewKeys.item('workshop').queryKey;
  const feedback = previewKeys.item('feedback').queryKey;
  const offsite = previewKeys.item('offsite').queryKey;
  queryClient.setQueryData<PreviewItem>(workshop, {
    id: 'workshop',
    type: 'form',
    loading: false,
    access: 'access',
    name: 'Workshop ideas',
    rawName: 'Workshop ideas',
    owner: 'macro|owner@example.com',
  });
  queryClient.setQueryData<PreviewItem>(feedback, {
    id: 'feedback',
    type: 'form',
    loading: false,
    access: 'access',
    name: 'Session feedback',
    rawName: 'Session feedback',
    owner: 'macro|owner@example.com',
  });
  queryClient.setQueryData<PreviewItem>(offsite, {
    id: 'offsite',
    type: 'form',
    loading: false,
    access: 'access',
    name: 'Offsite',
    rawName: 'Offsite',
    owner: 'macro|owner@example.com',
  });

  const result = await renameDatabase(
    {
      mutation: () => ({
        toPromise: async () => ({
          data: {
            renameEntities: {
              results: [{ __typename: 'GraphqlMutationSuccess' as const }],
            },
          },
        }),
      }),
    },
    'workshop-database',
    'Workshop 2026'
  );

  expect(result.isOk()).toBe(true);
  expect(queryClient.getQueryState(workshop)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(feedback)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryData(feedback)).toMatchObject({
    rawName: 'Session feedback',
  });
  expect(queryClient.getQueryState(offsite)?.isInvalidated).toBe(false);
});
