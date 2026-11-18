import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type InboxCardDisplayItem,
  TaskCardLayout,
} from './inbox-card-layouts';

vi.mock(
  '@app/features/next-soup/soup-view/views/tasks/list-property-value',
  () => ({
    ListPropertyValue: (props: { property: Property }) => (
      <button>
        {props.property.displayName}: {String(props.property.value)}
      </button>
    ),
  })
);
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => null,
  getEntityIconType: () => 'task',
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({ StaticMarkdown: () => null })
);
vi.mock('@property/context/PropertiesContext', () => ({
  PropertiesProvider: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: vi.fn() }),
}));

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

const taskItem = (value: string) =>
  ({
    entity: {
      id: 'task',
      name: 'Task',
      type: 'document',
      fileType: 'md',
      subType: { type: 'task' },
      ownerId: 'macro|owner@example.com',
      properties: [priority(value)],
    },
    unread: false,
  }) as unknown as InboxCardDisplayItem;

it('keeps a focused pill through each fresh emission of the task', () => {
  const [item, setItem] = createSignal(taskItem('low'));
  render(() => <TaskCardLayout item={item()} />);
  const pill = screen.getByRole('button', { name: /^Priority/ });
  pill.focus();

  setItem(taskItem('low'));
  setItem(taskItem('high'));

  expect(document.activeElement).toBe(pill);
});
