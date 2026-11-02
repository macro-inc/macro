import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EntityProperty } from '../types';
import { PropertyText } from './PropertyText';

const displays = vi.hoisted(() => ({ mounts: [] as string[] }));

vi.mock('@ui', async () => {
  const { cn } = await import('../../../components/ui/utils/classname');
  return { cn };
});
vi.mock('../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: (id: () => string) => {
    displays.mounts.push(id());
    return {
      name: () => (id() === 'launch' ? 'Product launch' : 'Website redesign'),
      icon: () => null,
    };
  },
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

afterEach(() => {
  cleanup();
  displays.mounts = [];
});

it('keeps a linked project in place while its property re-emits the same project', () => {
  const [property, setProperty] = createSignal(project);
  const view = render(() => (
    <PropertyText property={property()} resolveSingleEntity />
  ));
  const name = view.getByText('Product launch');

  setProperty({
    ...project,
    value: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
  });

  expect(view.getByText('Product launch')).toBe(name);
  expect(displays.mounts).toEqual(['launch']);

  setProperty({
    ...project,
    value: [{ entity_id: 'redesign', entity_type: 'INITIATIVE' }],
  });

  expect(view.getByText('Website redesign')).toBeTruthy();
  expect(displays.mounts).toEqual(['launch', 'redesign']);
});
