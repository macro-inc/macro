import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { describe, expect, it } from 'vitest';
import {
  apiValuesToGraphqlPropertyValue,
  buildOptimisticSetEntityProperty,
} from './graphql-optimistic';

describe('apiValuesToGraphqlPropertyValue', () => {
  it('converts each populated variant', () => {
    expect(
      apiValuesToGraphqlPropertyValue({ valueType: 'STRING', value: 'hi' })
    ).toEqual({
      __typename: 'GraphqlStringPropertyValue',
      stringValue: 'hi',
    });

    expect(
      apiValuesToGraphqlPropertyValue({ valueType: 'NUMBER', value: 3 })
    ).toEqual({
      __typename: 'GraphqlNumberPropertyValue',
      numberValue: 3,
    });

    expect(
      apiValuesToGraphqlPropertyValue({ valueType: 'BOOLEAN', value: false })
    ).toEqual({
      __typename: 'GraphqlBooleanPropertyValue',
      boolValue: false,
    });

    expect(
      apiValuesToGraphqlPropertyValue({
        valueType: 'DATE',
        value: new Date('2026-07-10T00:00:00.000Z'),
      })
    ).toEqual({
      __typename: 'GraphqlDatePropertyValue',
      dateValue: '2026-07-10T00:00:00.000Z',
    });

    // Single- and multi-select share the SelectOption shape.
    expect(
      apiValuesToGraphqlPropertyValue({
        valueType: 'SELECT_STRING',
        values: ['opt-1'],
      })
    ).toEqual({
      __typename: 'GraphqlSelectOptionPropertyValue',
      optionIds: ['opt-1'],
    });
    expect(
      apiValuesToGraphqlPropertyValue({
        valueType: 'SELECT_NUMBER',
        values: ['opt-1', 'opt-2'],
      })
    ).toEqual({
      __typename: 'GraphqlSelectOptionPropertyValue',
      optionIds: ['opt-1', 'opt-2'],
    });

    expect(
      apiValuesToGraphqlPropertyValue({
        valueType: 'ENTITY',
        refs: [
          {
            entity_id: 'doc-1',
            entity_type: 'DOCUMENT',
            specific_message_id: 'msg-1',
          },
          { entity_id: 'user-1', entity_type: 'USER' },
        ],
      })
    ).toEqual({
      __typename: 'GraphqlEntityReferencePropertyValue',
      references: [
        {
          entityId: 'doc-1',
          entityType: 'DOCUMENT',
          specificMessageId: 'msg-1',
        },
        { entityId: 'user-1', entityType: 'USER', specificMessageId: null },
      ],
    });

    expect(
      apiValuesToGraphqlPropertyValue({
        valueType: 'LINK',
        values: ['https://a'],
      })
    ).toEqual({
      __typename: 'GraphqlLinkPropertyValue',
      urls: ['https://a'],
    });
  });

  it('maps empty variants to null (clearing the value)', () => {
    expect(
      apiValuesToGraphqlPropertyValue({ valueType: 'STRING', value: null })
    ).toBeNull();
    expect(
      apiValuesToGraphqlPropertyValue({ valueType: 'DATE', value: null })
    ).toBeNull();
    expect(
      apiValuesToGraphqlPropertyValue({
        valueType: 'SELECT_STRING',
        values: [],
      })
    ).toBeNull();
    expect(
      apiValuesToGraphqlPropertyValue({ valueType: 'ENTITY', refs: null })
    ).toBeNull();
    expect(
      apiValuesToGraphqlPropertyValue({ valueType: 'LINK', values: null })
    ).toBeNull();
  });
});

describe('buildOptimisticSetEntityProperty', () => {
  const instantiated: Property = {
    propertyId: 'prop-1',
    propertyDefinitionId: 'def-1',
    displayName: 'Status',
    isMultiSelect: false,
    isMetadata: false,
    isSystemProperty: true,
    owner: { scope: 'system' } as never,
    specificEntityType: 'DOCUMENT',
    createdAt: '' as never,
    updatedAt: '' as never,
    valueType: 'SELECT_STRING',
    value: null,
  };

  const definitionOnly: PropertyDefinitionDomain = {
    id: 'def-1',
    displayName: 'Status',
    valueType: 'SELECT_STRING',
    isMultiSelect: false,
    isMetadata: false,
    isSystem: true,
    owner: { scope: 'system' } as never,
    createdAt: '' as never,
    updatedAt: '' as never,
  };

  it('builds a complete payload for an existing assignment', () => {
    const apiValues: PropertyApiValues = {
      valueType: 'SELECT_STRING',
      values: ['opt-done'],
    };
    expect(buildOptimisticSetEntityProperty(instantiated, apiValues)).toEqual({
      id: 'prop-1',
      propertyDefinitionId: 'def-1',
      displayName: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      specificEntityType: 'DOCUMENT',
      isSystem: true,
      isMetadata: false,
      value: {
        __typename: 'GraphqlSelectOptionPropertyValue',
        optionIds: ['opt-done'],
      },
    });
  });

  it('skips optimism for uninstantiated definitions (no stable id)', () => {
    expect(
      buildOptimisticSetEntityProperty(definitionOnly, {
        valueType: 'SELECT_STRING',
        values: ['opt-done'],
      })
    ).toBeUndefined();
  });
});
