import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { Property } from '../types';
import { PropertyText } from './PropertyText';

vi.mock('../hooks/usePropertyUserDisplay', () => ({
  usePropertyUserDisplay: (id: () => string) => ({
    shortName: () => (id().startsWith('bot|') ? 'Deploy Agent' : 'Sam'),
  }),
}));
vi.mock('../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: (id: () => string) => ({
    name: () => (id() === 'doc-1' ? 'Design brief' : 'Project notes'),
    icon: () => <svg data-testid="entity-icon" />,
  }),
}));
afterEach(cleanup);

const property: Property & { valueType: 'ENTITY' } = {
  propertyId: 'assignment',
  propertyDefinitionId: 'definition',
  displayName: 'Related documents',
  valueType: 'ENTITY',
  specificEntityType: 'DOCUMENT',
  value: [{ entity_id: 'doc-1', entity_type: 'DOCUMENT' }],
  isMultiSelect: true,
  owner: { scope: 'system' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

it('shows one linked item by name and multiple linked items by count', () => {
  const [current, setCurrent] = createSignal(property);
  render(() => <PropertyText property={current()} resolveSingleEntity />);
  expect(screen.getByText('Design brief')).toBeTruthy();
  expect(screen.getByTestId('entity-icon')).toBeTruthy();
  setCurrent({
    ...property,
    value: [
      { entity_id: 'doc-1', entity_type: 'DOCUMENT' },
      { entity_id: 'doc-2', entity_type: 'DOCUMENT' },
    ],
  });
  expect(screen.getByText('2 items')).toBeTruthy();
  expect(screen.queryByTestId('entity-icon')).toBeNull();
  setCurrent({
    ...property,
    value: [{ entity_id: 'doc-2', entity_type: 'DOCUMENT' }],
  });
  expect(screen.getByText('Project notes')).toBeTruthy();
});

it('preserves the empty fallback when a linked property has no value', () => {
  render(() => (
    <PropertyText
      property={{ ...property, value: [] }}
      resolveSingleEntity
      fallback="Related documents"
    />
  ));
  expect(screen.getByText('Related documents')).toBeTruthy();
});

it('keeps explicit text overrides when resolving linked names', () => {
  render(() => (
    <PropertyText property={property} resolveSingleEntity text="Custom label" />
  ));
  expect(screen.getByText('Custom label')).toBeTruthy();
  expect(screen.queryByText('Design brief')).toBeNull();
});

it('resolves bot assignees while retaining mixed-assignee counts', () => {
  const [current, setCurrent] = createSignal<Property>({
    ...property,
    specificEntityType: 'USER',
    value: [
      {
        entity_id: 'bot|5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f',
        entity_type: 'USER',
      },
    ],
  });
  render(() => <PropertyText property={current()} resolveSingleEntity />);
  expect(screen.getByText('Deploy Agent')).toBeTruthy();
  setCurrent({
    ...property,
    specificEntityType: 'USER',
    value: [
      {
        entity_id: 'bot|5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f',
        entity_type: 'USER',
      },
      { entity_id: 'macro|sam@example.com', entity_type: 'USER' },
    ],
  });
  expect(screen.getByText('2 assignees')).toBeTruthy();
});
