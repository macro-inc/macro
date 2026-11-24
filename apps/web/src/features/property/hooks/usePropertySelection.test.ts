import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../identifiers';
import type { PropertyDefinitionDomain } from '../types';
import { usePropertySelection } from './usePropertySelection';

function definition(
  id: string,
  displayName: string,
  valueType: PropertyDefinitionDomain['valueType']
): PropertyDefinitionDomain {
  return {
    id,
    displayName,
    valueType,
    isMultiSelect: false,
    isMetadata: false,
    isSystem: true,
    owner: { scope: 'system' },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

it('never offers properties that are set elsewhere or computed', () => {
  const effort = definition('effort', 'Effort', 'NUMBER');
  const names = createRoot((dispose) => {
    const { filteredProperties } = usePropertySelection(
      () => [],
      () => [
        effort,
        definition(SYSTEM_PROPERTY_IDS.START_DATE, 'Start Date', 'DATE'),
        definition(SYSTEM_PROPERTY_IDS.TIME_LOGGED, 'Time logged', 'NUMBER'),
      ]
    );
    const result = filteredProperties().map((property) => property.displayName);
    dispose();
    return result;
  });
  expect(names).toEqual(['Effort']);
});
