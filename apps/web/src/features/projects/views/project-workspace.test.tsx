import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectsProvider } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import { ProjectWorkspace } from './project-workspace';

vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Layout: (props: { children: JSX.Element }) => props.children,
    Footer: () => null,
    Section: () => null,
  },
}));
vi.mock('@components/app/side-panel/EntityMetadata', () => ({
  EntityMetadata: () => null,
}));
vi.mock('@core/component/InlineTitleEditor', () => ({
  InlineTitleEditor: () => null,
}));
vi.mock('@property/component/PropertyValuePill', () => ({
  PropertyValuePill: (props: { property: Property }) => (
    <button>
      {props.property.displayName}: {String(props.property.value)}
    </button>
  ),
}));
vi.mock('@property/side-panel/properties/EntityPropertiesSection', () => ({
  EntityPropertiesSection: () => null,
}));
vi.mock('../add-project-tasks', () => ({ AddProjectTasks: () => null }));
vi.mock('./project-tasks-list', () => ({ ProjectTasksList: () => null }));

afterEach(cleanup);

const priority = (value: string) =>
  ({
    propertyId: 'priority-assignment',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
    displayName: 'Priority',
    isMultiSelect: false,
    owner: { scope: 'system' },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    valueType: 'SELECT_STRING',
    value: [value],
  }) satisfies Property;

const project = {
  id: 'launch',
  name: 'Launch',
  access: 'owner',
} as ProjectDetail;

it('keeps a focused pill through each fresh emission of the project source', () => {
  const [properties, setProperties] = createSignal<Property[]>([
    priority('low'),
  ]);
  const context = {
    createPropertyDefinitionsSource: () => ({
      properties: () => [],
      loading: () => false,
      error: () => undefined,
    }),
  } as unknown as Parameters<typeof ProjectsProvider>[0]['context'];
  render(() => (
    <ProjectsProvider context={context}>
      <ProjectWorkspace
        project={project}
        source={{
          project: () => project,
          properties,
          loading: () => false,
          error: () => undefined,
          refresh: async () => {},
        }}
        commands={{} as Parameters<typeof ProjectWorkspace>[0]['commands']}
        section="overview"
        onOpenTask={() => true}
        onCreateTask={() => {}}
        discussion={null}
        description={null}
      />
    </ProjectsProvider>
  ));
  const pill = screen.getByRole('button', { name: 'Priority: low' });
  pill.focus();

  setProperties([priority('low')]);
  setProperties([priority('high')]);

  expect(document.activeElement).toBe(pill);
  expect(pill.textContent).toBe('Priority: high');
});
