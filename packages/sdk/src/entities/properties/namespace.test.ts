import { describe, expect, test } from 'bun:test';
import type {
  AddPropertyOptionData,
  EnsureTagSetData,
  PropertyOption as PropertyOptionRecord,
  TagSetResponse,
} from '../../../generated/properties/types.gen';
import type { MacroClient } from '../../utils/client';
import { PropertiesNamespace } from './namespace';

describe('PropertiesNamespace.createTag', () => {
  test('provisions the team tag set, then adds the label after its existing tags', async () => {
    const calls: string[] = [];
    const ensured: EnsureTagSetData['body'][] = [];
    const added: { definition: string; body: AddPropertyOptionData['body'] }[] =
      [];
    const tagSet: TagSetResponse = {
      scope: 'team',
      definition: {
        id: 'team-tags',
        displayName: 'Tags',
        dataType: 'SELECT_STRING',
        isMetadata: false,
        isMultiSelect: true,
        isSystem: true,
        scope: 'team',
        team_id: 'team-1',
      },
      options: [
        {
          id: 'option-1',
          displayOrder: 0,
          propertyDefinitionId: 'team-tags',
          value: { type: 'string', value: 'Urgent' },
        },
      ],
    };
    const created: PropertyOptionRecord = {
      id: 'option-2',
      color: '#46A758',
      display_order: 1,
      property_definition_id: 'team-tags',
      created_at: '2026-11-05T00:00:00Z',
      updated_at: '2026-11-05T00:00:00Z',
      value: { type: 'string', value: 'Follow-up' },
    };
    const client = {
      properties: {
        ensureTagSet: async (options: { body: EnsureTagSetData['body'] }) => {
          calls.push('ensureTagSet');
          ensured.push(options.body);
          return { data: tagSet };
        },
        addPropertyOption: async (options: {
          path: AddPropertyOptionData['path'];
          body: AddPropertyOptionData['body'];
        }) => {
          calls.push('addPropertyOption');
          added.push({
            definition: options.path.definition_id,
            body: options.body,
          });
          return { data: created };
        },
      },
    } as unknown as MacroClient;

    const tag = await new PropertiesNamespace(client).createTag({
      label: 'Follow-up',
      color: '#46A758',
      scope: 'team',
    });

    expect(calls).toEqual(['ensureTagSet', 'addPropertyOption']);
    expect(ensured).toEqual([{ scope: 'team' }]);
    expect(added).toEqual([
      {
        definition: 'team-tags',
        body: {
          type: 'select_string',
          option: { value: 'Follow-up', color: '#46A758', display_order: 1 },
        },
      },
    ]);
    expect(tag.id).toBe('option-2');
    expect(tag.definitionId).toBe('team-tags');
    expect(tag.value).toEqual({ type: 'string', value: 'Follow-up' });
  });

  test('defaults to the personal set', async () => {
    const ensured: EnsureTagSetData['body'][] = [];
    const client = {
      properties: {
        ensureTagSet: async (options: { body: EnsureTagSetData['body'] }) => {
          ensured.push(options.body);
          return {
            data: {
              scope: 'user',
              definition: {
                id: 'personal-tags',
                displayName: 'Tags',
                dataType: 'SELECT_STRING',
                isMetadata: false,
                isMultiSelect: true,
                isSystem: true,
                scope: 'user',
                user_id: 'macro|user@example.com',
              },
              options: [],
            } satisfies TagSetResponse,
          };
        },
        addPropertyOption: async () => ({
          data: {
            id: 'option-1',
            color: null,
            display_order: 0,
            property_definition_id: 'personal-tags',
            created_at: '2026-11-05T00:00:00Z',
            updated_at: '2026-11-05T00:00:00Z',
            value: { type: 'string', value: 'Reading' },
          } satisfies PropertyOptionRecord,
        }),
      },
    } as unknown as MacroClient;

    const tag = await new PropertiesNamespace(client).createTag({
      label: 'Reading',
    });

    expect(ensured).toEqual([{ scope: 'user' }]);
    expect(tag.definitionId).toBe('personal-tags');
  });
});
