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

function context(canEdit: boolean): PropertyRootContextValue {
  return {
    property: () => property,
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

it('keeps a tab stop on a read-only value, which may hold no control', async () => {
  const user = userEvent.setup();
  render(() => (
    <PropertyRootContext.Provider value={context(false)}>
      <PropertyTooltip property={property}>
        <span>In progress</span>
      </PropertyTooltip>
    </PropertyRootContext.Provider>
  ));

  await user.tab();

  expect(document.activeElement?.textContent).toBe('In progress');
});
