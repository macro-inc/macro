import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EntityProperty } from '../types';
import { ListPropertyValue } from './ListPropertyValue';

vi.mock('@property', async () => {
  const { PropertyText } = await import('../extractors/PropertyText');
  const passthrough = (props: { children: JSX.Element }) => props.children;
  return {
    Property: {
      Root: passthrough,
      Tooltip: passthrough,
      EditTrigger: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
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
  usePropertyUserDisplay: () => ({ shortName: () => 'Alice' }),
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

  expect(view.getByRole('button').textContent).toBe('Product launch');
  setProperty({
    ...project,
    value: [{ entity_id: 'redesign', entity_type: 'INITIATIVE' }],
  });
  expect(view.getByRole('button').textContent).toBe('Website redesign');
  setProperty({ ...project, value: null });
  expect(view.getByRole('button').textContent).toBe('Project');
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
  expect(view.getByRole('button').textContent).toBe('2 items');
});
