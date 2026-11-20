import { describe, expect, test } from 'bun:test';
import type { CreatePropertyDefinitionData } from '../generated/properties/types.gen';
import { PropertiesNamespace } from '../src/entities/properties/namespace';
import type { MacroClient } from '../src/utils/client';

function propertiesClient() {
  const created: Pick<CreatePropertyDefinitionData, 'body'>[] = [];
  const client = {
    properties: {
      createPropertyDefinition: async (
        options: Pick<CreatePropertyDefinitionData, 'body'>,
      ) => {
        created.push(options);
        return { data: { id: 'property-1' } };
      },
    },
  } as unknown as MacroClient;
  return { client, created };
}

describe('properties.create', () => {
  test('a property created without a scope is the user’s own', async () => {
    const { client, created } = propertiesClient();

    const property = await new PropertiesNamespace(client).create({
      displayName: 'Hours Spent',
      dataType: { type: 'number' },
    });

    expect(property.id).toBe('property-1');
    expect(created).toEqual([
      {
        body: {
          display_name: 'Hours Spent',
          scope: 'user',
          data_type: { type: 'number' },
        },
      },
    ]);
  });

  test('a team property is created only when asked for', async () => {
    const { client, created } = propertiesClient();

    await new PropertiesNamespace(client).create({
      displayName: 'Hours Spent',
      dataType: { type: 'number' },
      scope: 'team',
    });

    expect(created[0]?.body.scope).toBe('team');
  });
});
