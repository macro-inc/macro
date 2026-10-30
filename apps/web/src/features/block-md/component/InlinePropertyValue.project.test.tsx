import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { useProperty } from '@property/core/context';
import type { Property } from '@property/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InlinePropertyValue } from './InlinePropertyValue';

const { openProject } = vi.hoisted(() => ({ openProject: vi.fn() }));

vi.mock('@app/features/projects/open-project', () => ({ openProject }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => 'layout',
}));
vi.mock('@property/editors/popover/EntityEditor', () => ({
  EntityEditor: () => (
    <Show when={useProperty().editorOpen()}>
      <div>Project picker</div>
    </Show>
  ),
}));
vi.mock('@property/hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: () => ({
    name: () => 'Launch',
    icon: () => null,
    nativeProjectId: () => 'launch',
    isLoading: () => false,
  }),
}));

const project: Property = {
  propertyId: 'assignment',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
  displayName: 'Project',
  valueType: 'ENTITY',
  specificEntityType: 'INITIATIVE',
  isMultiSelect: false,
  value: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
  owner: { scope: 'system' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function renderPill(entityId?: string) {
  render(() => (
    <PropertiesProvider
      entityId={entityId ?? 'draft'}
      entityType="TASK"
      canEdit
      properties={() => [project]}
      onRefresh={vi.fn()}
      onPropertyAdded={vi.fn()}
      onPropertyDeleted={vi.fn()}
      saveHandler={{ saveProperty: vi.fn(), saveDate: vi.fn() }}
    >
      <InlinePropertyValue property={project} entityId={entityId} />
    </PropertiesProvider>
  ));
}

beforeEach(() => openProject.mockClear());
afterEach(cleanup);

it("opens a saved task's project from its name", () => {
  renderPill('task');

  fireEvent.click(screen.getByRole('button', { name: 'Open project Launch' }));

  expect(openProject).toHaveBeenCalledWith('layout', 'launch', {
    newSplit: false,
  });
});

it("keeps a composer's draft in place when its project is clicked", () => {
  renderPill();

  expect(screen.queryByRole('button', { name: 'Change project' })).toBeNull();
  expect(screen.queryByText('Project picker')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Launch/ }));

  expect(screen.getByText('Project picker')).toBeTruthy();
  expect(openProject).not.toHaveBeenCalled();
});
