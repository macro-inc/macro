import { cleanup, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectRow as ProjectRowData } from '../context/projects-context';

const fixtures = vi.hoisted(() => ({ canEdit: [] as boolean[] }));
vi.mock('@ui', async () => await import('@app/components/ui/utils/classname'));
vi.mock('@entity', () => ({
  Entity: {
    Layout: (props: ParentProps) => <div>{props.children}</div>,
    Slot: (props: ParentProps) => <div>{props.children}</div>,
  },
  MultiSelectCheckbox: () => <input type="checkbox" aria-label="Select" />,
}));
vi.mock('@property/component/ListPropertyValue', () => ({
  ListPropertyValue: () => null,
}));
vi.mock('@property/component/modal', () => ({ Modals: () => null }));
vi.mock('@property/context/PropertiesContext', () => ({
  PropertiesProvider: (props: ParentProps<{ canEdit: boolean }>) => {
    fixtures.canEdit.push(props.canEdit);
    return props.children;
  },
}));

import { ProjectRow } from './project-row';

afterEach(() => {
  cleanup();
  fixtures.canEdit = [];
});

function renderRow(pending: ProjectRowData['pending']) {
  render(() => (
    <ProjectRow
      rowId="row"
      row={{
        project: {
          id: 'project',
          name: 'Launch',
          descriptionDocumentId: '',
          updatedAt: '',
          access: 'owner',
        },
        properties: [],
        pending,
      }}
      highlighted={false}
      checked={false}
      onFocus={() => {}}
      onOpen={() => {}}
      onChecked={() => {}}
      onSave={async () => {}}
    />
  ));
  return screen.getByRole('row');
}

it.each([
  { pending: undefined, editable: true, busy: false },
  // Created, but still showing its submitted values: edits wait for the
  // server row, so they can never appear to revert.
  { pending: 'created', editable: false, busy: false },
  { pending: 'creating', editable: false, busy: true },
] as const)(
  'a $pending row is editable=$editable and busy=$busy',
  ({ pending, editable, busy }) => {
    const row = renderRow(pending);
    expect(fixtures.canEdit).toEqual([editable]);
    expect(row.getAttribute('aria-busy')).toBe(busy ? 'true' : null);
    expect(row.classList.contains('opacity-60')).toBe(busy);
    expect(screen.queryByRole('checkbox', { name: 'Select' }) !== null).toBe(
      !busy
    );
  }
);
