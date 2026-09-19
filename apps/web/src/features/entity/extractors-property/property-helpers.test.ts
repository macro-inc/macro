// @vitest-environment jsdom
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { formatPropertyValue } from '@property/utils/formatting';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { describe, expect, it } from 'vitest';
import { soupPropertyToProperty } from './property-helpers';

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
