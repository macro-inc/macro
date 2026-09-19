/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PropertyRootContext,
  type PropertyRootContextValue,
} from '../core/context';
import type { Property } from '../types';
import { PropertyPill } from './PropertyPill';

vi.mock('@ui', async () => {
  const badge = await import('../../../components/ui/components/Badge');
  const { cn } = await import('../../../components/ui/utils/classname');
  return { ...badge, cn };
});

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

function context(
  canEdit: boolean,
  value: Property,
  onEdit = vi.fn()
): PropertyRootContextValue {
  return {
    property: () => value,
    canEdit: () => canEdit,
    onEdit,
    editorOpen: () => false,
    openEditor: vi.fn(),
    closeEditor: vi.fn(),
  };
}

afterEach(cleanup);

describe('PropertyPill', () => {
  it('uses the interactive ghost/sm contract when editable', async () => {
    const onEdit = vi.fn();

    render(() => (
      <PropertyRootContext.Provider value={context(true, property, onEdit)}>
        <PropertyPill>Status</PropertyPill>
      </PropertyRootContext.Provider>
    ));

    const pill = screen.getByRole('button', { name: 'Status' });
    expect(pill.classList).toContain('h-6');
    expect(pill.classList).toContain('border-transparent');
    expect(pill.classList).toContain('bg-transparent');
    expect(pill.classList).toContain('rounded-full');
    expect(pill.classList).toContain('not-disabled:hover:overlay-hover');

    await fireEvent.click(pill);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('remains passive when the property is read-only', () => {
    render(() => (
      <PropertyRootContext.Provider value={context(false, property)}>
        <PropertyPill>Status</PropertyPill>
      </PropertyRootContext.Provider>
    ));

    const pill = screen.getByRole('button', { name: 'Status' });
    expect(pill.classList).not.toContain('not-disabled:hover:overlay-hover');
    expect(pill.getAttribute('aria-disabled')).toBe('true');
    expect(pill.dataset.readonly).toBe('');
  });

  it('mutes an empty property', () => {
    render(() => (
      <PropertyRootContext.Provider
        value={context(true, { ...property, value: null })}
      >
        <PropertyPill>Set status</PropertyPill>
      </PropertyRootContext.Provider>
    ));

    expect(screen.getByRole('button').classList).toContain(
      'text-ink-extra-muted'
    );
  });
});
