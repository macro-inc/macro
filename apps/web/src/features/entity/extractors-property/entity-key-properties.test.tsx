import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EntityData, EntityWithProperties } from '../types/entity';
import { EntityKeyProperties } from './entity-key-properties';

vi.mock('@core/component/ScopedPortal', () => ({ ScopedPortal: () => null }));
vi.mock('@property', async (importOriginal) => {
  const passthrough = (props: { children: JSX.Element }) => props.children;
  return {
    ...(await importOriginal<typeof import('@property')>()),
    Property: {
      Root: (props: {
        property: Property;
        children: (property: () => Property) => JSX.Element;
      }) => props.children(() => props.property),
      Tooltip: passthrough,
      EditTrigger: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props} />
      ),
      Text: (props: { property: Property }) => (
        <span>
          {props.property.displayName}: {String(props.property.value)}
        </span>
      ),
      Icon: () => null,
      UserStack: () => null,
      Empty: () => null,
      Caret: () => null,
      PopoverEditor: () => null,
    },
  };
});
vi.mock('@property/component/modal', () => ({ Modals: () => null }));
vi.mock('@property/context/PropertiesContext', () => ({
  PropertiesProvider: (props: { children: JSX.Element }) => props.children,
  usePropertiesContext: () => ({
    entityType: 'TASK',
    canEdit: true,
    saveHandler: { saveProperty: vi.fn() },
  }),
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@ui', async () => {
  const { cn } = await import('../../../components/ui/utils/classname');
  return {
    cn,
    Layer: (props: { children: JSX.Element }) => props.children,
  };
});

afterEach(cleanup);

const priority = (value: string) =>
  ({
    id: 'priority-assignment',
    definition: {
      id: SYSTEM_PROPERTY_IDS.PRIORITY,
      display_name: 'Priority',
      data_type: 'SELECT_STRING',
      is_multi_select: false,
      is_metadata: false,
      is_system: true,
      owner: { scope: 'system' },
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    },
    value: { type: 'SelectOption', value: [value] },
  }) as unknown as SoupProperty;

const task = (value: string) =>
  ({
    id: 'task',
    type: 'document',
    fileType: 'md',
    subType: { type: 'task' },
    properties: [priority(value)],
  }) as unknown as EntityWithProperties<EntityData>;

it('keeps a focused pill when the row hands it a fresh property', () => {
  const [entity, setEntity] = createSignal(task('low'));
  render(() => <EntityKeyProperties entity={entity()} />);
  const pill = screen.getByRole('button', { name: /^Priority/ });
  pill.focus();

  setEntity(task('low'));
  setEntity(task('high'));

  expect(document.activeElement).toBe(pill);
});
