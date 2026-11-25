import type { TaskEntity } from '@entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PropertyEditorDialog } from './PropertyEditorModal';
import type { PropertyEditorEntity } from './state/propertyEditor';

function definition(
  id: string,
  displayName: string,
  isSystem: boolean
): PropertyDefinition {
  return {
    id,
    display_name: displayName,
    data_type: 'STRING',
    is_multi_select: false,
    is_metadata: false,
    is_system: isSystem,
    owner: isSystem ? { scope: 'system' } : { scope: 'team', team_id: 't1' },
    specific_entity_type: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

const STAGE = definition('00000001-0000-0000-0000-000000000010', 'Stage', true);
const PARENT_TASK = definition(
  '00000001-0000-0000-0000-000000000005',
  'Parent Task',
  true
);
const PHONE = definition(
  '0193a9f0-0000-7000-8000-0000000000a1',
  'Phone',
  false
);

// What the properties service answers for `for_entity_type`: everything
// without one, otherwise only the definitions an entity of that type takes.
const APPLICABLE: Partial<Record<EntityType, PropertyDefinition[]>> = {
  COMPANY: [STAGE, PHONE],
  CONTACT: [PHONE],
  TASK: [PARENT_TASK, PHONE],
};

vi.mock('@queries/properties/definitions', () => ({
  fetchPropertyDefinitionWithOptions: vi.fn(),
  isPropertyNameReserved: () => false,
  useCreatePropertyDefinitionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useListPropertiesQuery: (params: () => { forEntityType?: EntityType }) => ({
    isSuccess: true,
    isPending: false,
    get data() {
      const forEntityType = params().forEntityType;
      const definitions = forEntityType
        ? (APPLICABLE[forEntityType] ?? [])
        : [STAGE, PARENT_TASK, PHONE];
      return definitions.map((item) => ({
        definition: item,
        property_options: [],
      }));
    },
  }),
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ isSuccess: false, data: undefined }),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@example.com',
}));

beforeEach(() => {
  // The list scrolls its focused row into view; jsdom has no scrolling.
  vi.stubGlobal('scrollTo', () => {});
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openSelector(entity: PropertyEditorEntity) {
  render(() => (
    <PropertyEditorDialog
      isOpen
      state={{ mode: 'selector', selectedEntities: [entity] }}
      onModeChange={vi.fn()}
      onTargetChange={vi.fn()}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />
  ));
}

function listed(name: string) {
  return screen.queryByText(name) !== null;
}

it('offers a contact only the properties it can take', () => {
  openSelector({ id: 'contact-1', name: 'Ada', entityType: 'CONTACT' });

  expect(listed('Phone')).toBe(true);
  expect(listed('Stage')).toBe(false);
  expect(listed('Parent Task')).toBe(false);
});

it('offers a company its own properties but no task-only ones', () => {
  openSelector({ id: 'company-1', name: 'Acme', entityType: 'COMPANY' });

  expect(listed('Stage')).toBe(true);
  expect(listed('Phone')).toBe(true);
  expect(listed('Parent Task')).toBe(false);
});

it('treats a task picked from a list as a task, not a document', () => {
  const task: TaskEntity = {
    id: 'task-1',
    name: 'Write the brief',
    ownerId: 'macro|viewer@example.com',
    type: 'document',
    fileType: 'md',
    subType: { type: 'task' },
  };
  openSelector(task);

  expect(listed('Parent Task')).toBe(true);
  expect(listed('Phone')).toBe(true);
  expect(listed('Stage')).toBe(false);
});
