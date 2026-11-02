/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  PropertyRootContext,
  type PropertyRootContextValue,
} from '../core/context';
import type { Property } from '../types';
import { PropertyPill } from './PropertyPill';
import { PropertyTooltip } from './PropertyTooltip';

const property: Property = {
  propertyId: 'status-property',
  propertyDefinitionId: 'status-definition',
  displayName: 'Status',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'SELECT_STRING',
  value: ['in-progress'],
};

function context(canEdit: boolean, value = property): PropertyRootContextValue {
  return {
    property: () => value,
    pickedEntityName: () => undefined,
    canEdit: () => canEdit,
    editorOpen: () => false,
    openEditor: vi.fn(),
    closeEditor: vi.fn(),
  };
}

afterEach(cleanup);

it('tabs straight to an editable pill, where Enter opens its editor', async () => {
  const user = userEvent.setup();
  const value = context(true);
  render(() => (
    <PropertyRootContext.Provider value={value}>
      <PropertyTooltip property={property}>
        <PropertyPill>Status</PropertyPill>
      </PropertyTooltip>
    </PropertyRootContext.Provider>
  ));

  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button'));

  await user.keyboard('{Enter}');
  expect(value.openEditor).toHaveBeenCalledOnce();
});

it.each([
  { name: 'without edit access', canEdit: false, isMetadata: false },
  { name: 'on a metadata property', canEdit: true, isMetadata: true },
])(
  'keeps a tab stop on a value that may hold no control $name',
  async ({ canEdit, isMetadata }) => {
    const user = userEvent.setup();
    const value = { ...property, isMetadata };
    render(() => (
      <PropertyRootContext.Provider value={context(canEdit, value)}>
        <PropertyTooltip property={value}>
          <span>In progress</span>
        </PropertyTooltip>
      </PropertyRootContext.Provider>
    ));

    await user.tab();

    expect(document.activeElement?.textContent).toBe('In progress');
  }
);
