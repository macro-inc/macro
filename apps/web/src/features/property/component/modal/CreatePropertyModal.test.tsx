import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import { PROPERTY_NAME_RESERVED_CODE } from '@service-properties/client';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreatePropertyModal } from './CreatePropertyModal';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createCallbacks: undefined as
    | { onError?: (error: Error, variables: unknown) => void }
    | undefined,
  builtIns: undefined as PropertyDefinition[] | undefined,
  applicableIds: [] as string[],
  refreshFailed: false,
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
}));
vi.mock('@queries/properties/entity', () => ({
  useAddEntityPropertyMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('@queries/properties/definitions', () => ({
  isPropertyNameReserved: (error: unknown) =>
    thrownResultErrorHasCode(error, PROPERTY_NAME_RESERVED_CODE),
  useCreatePropertyDefinitionMutation: (
    callbacks: typeof mocks.createCallbacks
  ) => {
    mocks.createCallbacks = callbacks;
    return { mutate: mocks.create, isPending: false };
  },
  // Built-in definitions, narrowed to the applicable ones when a type is asked.
  // A disabled query still answers from its cache, so `enabled` is not read.
  // A refresh that fails leaves the query in error with its last answer.
  useListPropertiesQuery: (params: () => { forEntityType?: string }) => ({
    get isPending() {
      return mocks.builtIns === undefined;
    },
    get isSuccess() {
      return mocks.builtIns !== undefined && !mocks.refreshFailed;
    },
    get data() {
      if (mocks.builtIns === undefined) return undefined;
      return params().forEntityType
        ? mocks.builtIns.filter((item) => mocks.applicableIds.includes(item.id))
        : mocks.builtIns;
    },
  }),
}));

function builtIn(id: string, displayName: string): PropertyDefinition {
  return {
    id,
    display_name: displayName,
    data_type: 'ENTITY',
    is_multi_select: true,
    is_metadata: false,
    is_system: true,
    owner: { scope: 'system' },
    specific_entity_type: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

const NAME_REFUSED =
  'Contacts is a built-in property, so another property can’t use its name.';

beforeEach(() => {
  // The dialog shell watches its footer; jsdom has no observer for it.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  mocks.create.mockReset();
  mocks.createCallbacks = undefined;
  mocks.builtIns = [
    builtIn('contacts', 'Contacts'),
    builtIn('revenue', 'Revenue'),
  ];
  mocks.applicableIds = ['contacts'];
  mocks.refreshFailed = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('says a built-in name is taken, blocks Create and offers the built-in property', async () => {
  const onUseBuiltIn = vi.fn();
  render(() => (
    <CreatePropertyModal
      isOpen
      initialName="contacts"
      entityType="TASK"
      onClose={() => {}}
      onUseBuiltIn={onUseBuiltIn}
    />
  ));

  expect(await screen.findByText(NAME_REFUSED)).toBeTruthy();
  const create = screen.getByRole('button', { name: /^Create/ });
  expect((create as HTMLButtonElement).disabled).toBe(true);
  await fireEvent.keyDown(screen.getByPlaceholderText('Property name'), {
    key: 'Enter',
  });
  expect(mocks.create).not.toHaveBeenCalled();

  await fireEvent.click(screen.getByRole('button', { name: 'Use Contacts' }));
  expect(onUseBuiltIn).toHaveBeenCalledWith('contacts');
});

it('does not offer a built-in property that does not apply to the entity', async () => {
  render(() => (
    <CreatePropertyModal
      isOpen
      initialName="Revenue"
      entityType="TASK"
      onClose={() => {}}
      onUseBuiltIn={() => {}}
    />
  ));

  expect(
    await screen.findByText(
      'Revenue is a built-in property, so another property can’t use its name.'
    )
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Use Revenue' })).toBeNull();
  expect(
    (screen.getByRole('button', { name: /^Create/ }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

it('does not offer a built-in property when the entity type is unknown', async () => {
  render(() => (
    <CreatePropertyModal
      isOpen
      initialName="Contacts"
      onClose={() => {}}
      onUseBuiltIn={() => {}}
    />
  ));

  expect(await screen.findByText(NAME_REFUSED)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Use Contacts' })).toBeNull();
});

it('keeps the note and the offer when the built-in list fails to refresh', async () => {
  mocks.refreshFailed = true;
  render(() => (
    <CreatePropertyModal
      isOpen
      initialName="Contacts"
      entityType="TASK"
      onClose={() => {}}
      onUseBuiltIn={() => {}}
    />
  ));

  expect(await screen.findByText(NAME_REFUSED)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Use Contacts' })).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: /^Create/ }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

it('lets a name through once it no longer matches a built-in one', async () => {
  render(() => (
    <CreatePropertyModal isOpen initialName="Contacts" onClose={() => {}} />
  ));
  expect(await screen.findByText(NAME_REFUSED)).toBeTruthy();

  await fireEvent.input(screen.getByPlaceholderText('Property name'), {
    target: { value: 'Contacts met' },
  });

  expect(screen.queryByText(NAME_REFUSED)).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
  expect(mocks.create).toHaveBeenCalledOnce();
});

it('says why when the server refuses a built-in name the dialog did not know', async () => {
  // The built-in definitions have not loaded, so nothing stops the request.
  mocks.builtIns = undefined;
  render(() => (
    <CreatePropertyModal isOpen initialName="Contacts" onClose={() => {}} />
  ));

  await fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
  expect(mocks.create).toHaveBeenCalledOnce();
  // The field stays editable while the request is out.
  await fireEvent.input(screen.getByPlaceholderText('Property name'), {
    target: { value: 'Region' },
  });
  mocks.createCallbacks?.onError?.(
    new ThrownResultError([
      { code: PROPERTY_NAME_RESERVED_CODE, message: 'refused' },
    ]),
    mocks.create.mock.calls[0]?.[0]
  );

  expect(await screen.findByText(NAME_REFUSED)).toBeTruthy();
  expect(screen.queryByText(/^Region is a built-in property/)).toBeNull();
  expect(screen.queryByText('Unable to create property')).toBeNull();
});
