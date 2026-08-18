import type { PropertyDefinitionDomain } from '@property/types';
import { describe, expect, it } from 'vitest';
import { propertyValueLabel } from './property-change-label';

const definition = {
  id: 'def-1',
  displayName: 'Status',
  options: [
    {
      id: 'opt-in-progress',
      value: { type: 'string', value: 'In Progress' },
    },
    { id: 'opt-done', value: { type: 'string', value: 'Completed' } },
  ],
} as unknown as PropertyDefinitionDomain;

describe('propertyValueLabel', () => {
  it('resolves select option ids to their option names', () => {
    expect(
      propertyValueLabel(
        { type: 'SelectOption', value: ['opt-done'] },
        definition
      )
    ).toBe('Completed');
    expect(
      propertyValueLabel(
        { type: 'SelectOption', value: ['opt-in-progress', 'opt-done'] },
        definition
      )
    ).toBe('In Progress, Completed');
  });

  it('labels scalar values without a definition', () => {
    expect(
      propertyValueLabel({ type: 'String', value: 'hello' }, undefined)
    ).toBe('hello');
    expect(
      propertyValueLabel({ type: 'Boolean', value: true }, undefined)
    ).toBe('True');
    expect(propertyValueLabel({ type: 'Number', value: 42 }, undefined)).toBe(
      '42'
    );
  });

  it('returns undefined for unknown shapes instead of raw ids', () => {
    expect(propertyValueLabel(null, definition)).toBeUndefined();
    expect(propertyValueLabel('garbage', definition)).toBeUndefined();
    expect(
      propertyValueLabel(
        { type: 'SelectOption', value: ['missing-option'] },
        definition
      )
    ).toBeUndefined();
  });
});
