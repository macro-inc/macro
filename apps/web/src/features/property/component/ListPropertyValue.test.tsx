import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import type { EntityProperty } from '../types';
import { ListPropertyValue } from './ListPropertyValue';

vi.mock('@property', async () => {
  const { PropertyText } = await import('../extractors/PropertyText');
  return {
    Property: {
      Root: (props: {
        property: EntityProperty;
        children: (property: () => EntityProperty) => JSX.Element;
      }) => props.children(() => props.property),
      Tooltip: (props: { children: JSX.Element; actions?: JSX.Element }) => (
        <>
          {props.children}
          {props.actions}
        </>
      ),
      Pill: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props} />
      ),
      Text: PropertyText,
      Icon: () => null,
      UserStack: () => null,
      Caret: () => null,
      PopoverEditor: () => null,
    },
  };
});
vi.mock('@property/context/PropertiesContext', () => ({
  usePropertiesContext: () => ({
    entityType: 'TASK',
    canEdit: true,
    saveHandler: { saveProperty: vi.fn() },
    onRefresh: vi.fn(),
  }),
}));
vi.mock('@property/utils', async () => import('../utils/typeGuards'));
vi.mock('../hooks/useStartDateEnabled', () => ({
  useStartDateEnabled: () => () => false,
}));
vi.mock('@ui', async () => {
  const { cn } = await import('../../../components/ui/utils/classname');
  return {
    cn,
    Layer: (props: { children: JSX.Element }) => props.children,
  };
});
vi.mock('../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: (id: () => string) => ({
    name: () => (id() === 'launch' ? 'Product launch' : 'Website redesign'),
    icon: () => null,
  }),
}));
vi.mock('../hooks/usePropertyUserDisplay', () => ({
  usePropertyUserDisplay: (id: () => string) => ({
    name: () => (id() === 'macro|bob@example.com' ? 'Bob Stone' : 'Alice'),
    shortName: () => 'Alice',
  }),
}));

const project: EntityProperty = {
  propertyId: 'task-project',
  propertyDefinitionId: 'project-definition',
  displayName: 'Project',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'ENTITY',
  specificEntityType: 'INITIATIVE',
  value: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
};

afterEach(cleanup);

it('shows the linked project name and follows reassignment and clearing', () => {
  const [property, setProperty] = createSignal(project);
  const view = render(() => (
    <ListPropertyValue entityId="task" property={property()} />
  ));

  expect(
    view.getByRole('button', { name: 'Project: Product launch' })
  ).toBeDefined();
  setProperty({
    ...project,
    value: [{ entity_id: 'redesign', entity_type: 'INITIATIVE' }],
  });
  expect(
    view.getByRole('button', { name: 'Project: Website redesign' })
  ).toBeDefined();
  setProperty({ ...project, value: null });
  expect(view.getByRole('button', { name: 'Project' })).toBeDefined();
});

it('keeps a count when multiple projects are linked', () => {
  const view = render(() => (
    <ListPropertyValue
      entityId="task"
      property={{
        ...project,
        value: [
          { entity_id: 'launch', entity_type: 'INITIATIVE' },
          { entity_id: 'redesign', entity_type: 'INITIATIVE' },
        ],
      }}
    />
  ));
  expect(view.getByRole('button', { name: 'Project: 2 items' })).toBeDefined();
});

it('filters by the assignee picked in the hover card, and only for person properties', () => {
  const onFilterByUser = vi.fn();
  const assignees: EntityProperty = {
    ...project,
    propertyId: 'task-assignees',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
    displayName: 'Assignees',
    isMultiSelect: true,
    specificEntityType: 'USER',
    value: [
      { entity_id: 'macro|alice@example.com', entity_type: 'USER' },
      { entity_id: 'macro|bob@example.com', entity_type: 'USER' },
    ],
  };
  const [property, setProperty] = createSignal(assignees);
  const view = render(() => (
    <ListPropertyValue
      entityId="task"
      property={property()}
      onFilterByUser={onFilterByUser}
    />
  ));

  fireEvent.click(view.getByRole('button', { name: 'Filter by Bob Stone' }));
  expect(onFilterByUser).toHaveBeenCalledExactlyOnceWith(
    'macro|bob@example.com'
  );
  expect(view.getByRole('button', { name: 'Filter by Alice' })).toBeDefined();

  setProperty({ ...assignees, value: null });
  expect(view.queryByRole('button', { name: /^Filter by/ })).toBeNull();
  setProperty(project);
  expect(view.queryByRole('button', { name: /^Filter by/ })).toBeNull();
});
