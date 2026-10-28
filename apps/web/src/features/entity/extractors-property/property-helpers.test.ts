// @vitest-environment jsdom
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Property } from '@property/types';
import { formatPropertyValue } from '@property/utils/formatting';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { describe, expect, it } from 'vitest';
import {
  buildTaskProjectDefaultProperty,
  soupPropertyToProperty,
  withTaskProject,
} from './property-helpers';

const EPOCH_ZERO = new Date(0).toISOString();

const stageSoupProperty = (optionId: string): SoupProperty => ({
  id: SYSTEM_PROPERTY_IDS.STAGE,
  definition: {
    id: SYSTEM_PROPERTY_IDS.STAGE,
    display_name: 'Stage',
    data_type: 'SELECT_STRING',
    is_metadata: false,
    is_multi_select: false,
    is_system: true,
    owner: { scope: 'system' },
    specific_entity_type: null,
    created_at: EPOCH_ZERO,
    updated_at: EPOCH_ZERO,
  },
  value: { type: 'SelectOption', value: [optionId] },
});

describe('soupPropertyToProperty stage labels', () => {
  it.each([
    ['Lead', PROPERTY_OPTION_IDS.STAGE.LEAD],
    ['Demo', PROPERTY_OPTION_IDS.STAGE.DEMO],
    ['Customer', PROPERTY_OPTION_IDS.STAGE.CUSTOMER],
    ['Churned', PROPERTY_OPTION_IDS.STAGE.CHURNED],
    ['Qualified', PROPERTY_OPTION_IDS.STAGE.QUALIFIED],
    ['Trial', PROPERTY_OPTION_IDS.STAGE.TRIAL],
    ['Negotiation', PROPERTY_OPTION_IDS.STAGE.NEGOTIATION],
  ] as const)('formats %s from its option id', (label, optionId) => {
    const property = soupPropertyToProperty(stageSoupProperty(optionId));
    expect(formatPropertyValue(property, optionId)).toBe(label);
  });
});

describe('withTaskProject', () => {
  const status = {
    propertyId: 'status-row',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
    displayName: 'Status',
    valueType: 'SELECT_STRING',
    value: null,
    isMultiSelect: false,
    owner: { scope: 'system' },
    createdAt: '1970-01-01',
    updatedAt: '1970-01-01',
  } as Property;
  const project = {
    propertyId: 'project-row',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
    displayName: 'Project',
    valueType: 'ENTITY',
    value: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
    isMultiSelect: false,
    owner: { scope: 'system' },
    createdAt: '1970-01-01',
    updatedAt: '1970-01-01',
  } as Property;

  it("appends the task's Project after its key properties", () => {
    expect(withTaskProject([status], [status, project])).toEqual([
      status,
      project,
    ]);
  });

  it('appends the standard Project placeholder when the task has none', () => {
    const [, placeholder] = withTaskProject([status], [status]);
    expect(placeholder).toMatchObject({
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
      displayName: 'Project',
      valueType: 'ENTITY',
      specificEntityType: 'INITIATIVE',
    });
    expect(placeholder).toEqual(buildTaskProjectDefaultProperty());
  });
});
