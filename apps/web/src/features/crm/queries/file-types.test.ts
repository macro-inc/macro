import { catchToResult } from '@core/util/result';
import { registerEntityPropertyReader } from '@queries/properties/invalidation';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import { waitFor } from '@solidjs/testing-library';
import { onlineManager, QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createMemo, createRoot, createSignal, mapArray } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileTypesSource, decodeFileTypes } from './file-types';

vi.mock('@queries/soup/cache', () => ({
  refetchSoupEntity: vi.fn(async () => {}),
}));
vi.mock('@queries/soup/crm-association', () => ({
  refreshCrmAssociatedSoupQueries: vi.fn(async () => {}),
}));

const definition: PropertyDefinitionWithOptions = {
  definition: {
    id: 'file-type',
    display_name: 'File type',
    data_type: 'SELECT_STRING',
    is_metadata: false,
    is_multi_select: false,
    specific_entity_type: null,
    is_system: false,
    owner: { scope: 'team', team_id: 'team' },
    created_at: '',
    updated_at: '',
  },
  property_options: [
    {
      id: 'contract',
      property_definition_id: 'file-type',
      display_order: 0,
      color: null,
      value: { type: 'string', value: 'Contract' },
      created_at: '',
      updated_at: '',
    },
  ],
};
const disposals: (() => void)[] = [];
afterEach(() => {
  onlineManager.setOnline(true);
  for (const dispose of disposals.splice(0)) dispose();
  vi.mocked(refetchSoupEntity).mockReset();
});

function mount(ids: string[] = []) {
  const properties = {
    listProperties: vi
      .fn<typeof propertiesServiceClient.listProperties>()
      .mockResolvedValue(ok([definition])),
    getBulkEntityProperties: vi
      .fn<typeof propertiesServiceClient.getBulkEntityProperties>()
      .mockResolvedValue(ok({})),
    createPropertyDefinition:
      vi.fn<typeof propertiesServiceClient.createPropertyDefinition>(),
    addPropertyOption:
      vi.fn<typeof propertiesServiceClient.addPropertyOption>(),
    updatePropertyOption:
      vi.fn<typeof propertiesServiceClient.updatePropertyOption>(),
    deletePropertyOption:
      vi.fn<typeof propertiesServiceClient.deletePropertyOption>(),
    setEntityProperty:
      vi.fn<typeof propertiesServiceClient.setEntityProperty>(),
    appendCrmFileReferences:
      vi.fn<typeof propertiesServiceClient.appendCrmFileReferences>(),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createRoot((dispose) => {
    const [teamId, setTeamId] = createSignal('team');
    disposals.push(() => {
      dispose();
      client.clear();
    });
    const source = createFileTypesSource(
      { properties, client },
      () => 'user',
      teamId,
      {
        canEdit: () => () => true,
        candidates: () => ({
          files: () => [],
          pending: () => false,
          hasMore: () => false,
          error: () => undefined,
          loadMore: async () => {},
        }),
        create: async () => 'created',
      }
    );
    return {
      properties,
      source,
      client,
      setTeamId,
      classes: source.classifications(() => ids),
    };
  });
}

describe('team file types', () => {
  it.each(['initialize', 'add', 'rename', 'remove'] as const)(
    'keeps a committed %s successful when an active property reader cannot refresh',
    async (action) => {
      const { properties, source, client } = mount();
      await waitFor(() => expect(source.data()).toBeDefined());
      properties.listProperties.mockResolvedValue(ok([]));
      properties.createPropertyDefinition.mockResolvedValue(
        ok(definition.definition)
      );
      properties.addPropertyOption.mockResolvedValue(
        ok(definition.property_options[0])
      );
      properties.updatePropertyOption.mockResolvedValue(
        ok(definition.property_options[0])
      );
      properties.deletePropertyOption.mockResolvedValue(ok({ success: true }));
      const refetch = vi.fn(async () => {
        throw new Error('Reader unavailable');
      });
      disposals.push(
        registerEntityPropertyReader(client, {
          entityId: 'source-file',
          refetch,
        })
      );
      const actions = {
        initialize: () => source.initialize(),
        add: () => source.add('Agreement'),
        rename: () => source.rename('contract', 'Agreement'),
        remove: () => source.remove('contract'),
      };

      await expect(actions[action]()).resolves.toBeUndefined();

      expect(refetch).toHaveBeenCalledTimes(1);
      expect(client.getMutationCache().getAll()[0].state.status).toBe(
        'success'
      );
    }
  );

  it('fails an offline write immediately instead of queueing it for reconnect', async () => {
    const { properties, source, client } = mount();
    await waitFor(() => expect(source.data()).toBeDefined());
    properties.addPropertyOption.mockResolvedValue(
      err([{ code: 'NETWORK_ERROR', message: 'Offline' }])
    );
    onlineManager.setOnline(false);

    const completed = catchToResult(() => source.add('Agreement'));

    await waitFor(() =>
      expect(properties.addPropertyOption).toHaveBeenCalledTimes(1)
    );
    expect((await completed).isErr()).toBe(true);
    expect(client.getMutationCache().getAll()[0].state.isPaused).toBe(false);
    onlineManager.setOnline(true);
    expect(properties.addPropertyOption).toHaveBeenCalledTimes(1);
  });

  it.each(['add', 'attach'] as const)(
    'rejects %s if the session changes before the mutation executes',
    async (action) => {
      const { properties, source, setTeamId } = mount();
      await waitFor(() => expect(source.data()).toBeDefined());
      const actions = {
        add: () => source.add('Agreement'),
        attach: () =>
          source.attach('source-file', { type: 'company', id: 'company' }),
      };
      const pending = actions[action]();
      setTeamId('another-team');

      await expect(pending).rejects.toThrow('signed-in user or team changed');
      expect(properties.addPropertyOption).not.toHaveBeenCalled();
      expect(properties.appendCrmFileReferences).not.toHaveBeenCalled();
    }
  );

  it.each([
    'initialize',
    'add',
    'rename',
    'remove',
    'classify',
    'attach',
  ] as const)(
    'reports a refused %s through the mutation cache without retrying or refreshing',
    async (action) => {
      const { properties, source, client } = mount();
      await waitFor(() => expect(source.data()).toBeDefined());
      const refused = err([
        { code: 'FORBIDDEN' as const, message: 'Source is read-only' },
      ]);
      properties.createPropertyDefinition.mockResolvedValue(refused);
      properties.addPropertyOption.mockResolvedValue(refused);
      properties.updatePropertyOption.mockResolvedValue(refused);
      properties.deletePropertyOption.mockResolvedValue(refused);
      properties.setEntityProperty.mockResolvedValue(refused);
      properties.appendCrmFileReferences.mockResolvedValue(refused);
      // Setup rechecks the catalog, including after a possible concurrent setup.
      properties.listProperties.mockResolvedValue(ok([]));
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const actions = {
        initialize: () => source.initialize(),
        add: () => source.add('Agreement'),
        rename: () => source.rename('contract', 'Agreement'),
        remove: () => source.remove('contract'),
        classify: () => source.classify('source-file', 'contract'),
        attach: () =>
          source.attach('source-file', { type: 'company', id: 'company' }),
      };

      await expect(actions[action]()).rejects.toThrow('Source is read-only');

      const mutations = client.getMutationCache().getAll();
      expect(mutations).toHaveLength(1);
      expect(mutations[0].state.status).toBe('error');
      expect(mutations[0].state.failureCount).toBe(1);
      expect(invalidate).not.toHaveBeenCalled();
      expect(refetchSoupEntity).not.toHaveBeenCalled();
    }
  );

  it('keeps a committed classification and link successful when refreshing fails', async () => {
    const { properties, source, client } = mount();
    await waitFor(() => expect(source.data()).toBeDefined());
    properties.setEntityProperty.mockResolvedValue(ok({ success: true }));
    properties.appendCrmFileReferences.mockResolvedValue(ok({ success: true }));
    vi.mocked(refetchSoupEntity).mockRejectedValue(
      new Error('Refresh unavailable')
    );

    await expect(
      source.classify('source-file', 'contract')
    ).resolves.toBeUndefined();
    await expect(
      source.attach('source-file', { type: 'company', id: 'company' })
    ).resolves.toBeUndefined();

    expect(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.status)
    ).toEqual(['success', 'success']);
    expect(properties.setEntityProperty).toHaveBeenCalledTimes(1);
    expect(properties.appendCrmFileReferences).toHaveBeenCalledTimes(1);
  });

  it('preserves a rename draft when the catalog refreshes', async () => {
    const { properties, source } = mount();
    const rows = createRoot((dispose) => {
      disposals.push(dispose);
      return createMemo(
        mapArray(
          () => source.data()?.options ?? [],
          (option) => {
            const [draft, setDraft] = createSignal(option.name);
            return { option, draft, setDraft };
          }
        )
      );
    });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0];
    row.setDraft('Agreement');
    properties.listProperties.mockResolvedValue(
      ok([
        {
          ...definition,
          property_options: definition.property_options.map((option) => ({
            ...option,
            value: { type: 'string', value: 'Updated contract' },
          })),
        },
      ])
    );

    await source.refresh();

    await waitFor(() => expect(rows()[0].option.name).toBe('Updated contract'));
    expect(rows()[0]).toBe(row);
    expect(rows()[0].draft()).toBe('Agreement');
  });

  it('uses only the matching team property and rejects an incompatible definition', () => {
    expect(decodeFileTypes([definition], 'another-team')).toBeNull();
    expect(decodeFileTypes([definition], 'team')).toEqual({
      definitionId: 'file-type',
      options: [{ id: 'contract', name: 'Contract' }],
    });
    expect(() =>
      decodeFileTypes(
        [
          {
            ...definition,
            definition: { ...definition.definition, is_multi_select: true },
          },
        ],
        'team'
      )
    ).toThrow('single-select');
  });

  it('batches classification reads and distinguishes unclassified from unreadable files', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `doc-${index}`);
    const { properties, classes } = mount(ids);
    properties.getBulkEntityProperties.mockImplementation(async ({ body }) =>
      ok(
        Object.fromEntries(
          body.entities
            .filter(({ entity_id }) => entity_id !== 'doc-1')
            .map(({ entity_id }) => [entity_id, { entity_id, properties: [] }])
        )
      )
    );
    await waitFor(() => expect(classes.data()).toBeDefined());
    expect(properties.getBulkEntityProperties).toHaveBeenCalledTimes(2);
    expect(
      properties.getBulkEntityProperties.mock.calls[0][0].body.entities
    ).toHaveLength(100);
    expect(classes.data()?.get('doc-0')).toBeNull();
    expect(classes.data()?.has('doc-1')).toBe(false);
  });

  it('appends only the new record link and leaves the file type unchanged', async () => {
    const { properties, source } = mount();
    properties.appendCrmFileReferences.mockResolvedValue(ok({ success: true }));
    await source.attach('source-file', { type: 'contact', id: 'contact' });
    expect(properties.appendCrmFileReferences).toHaveBeenCalledWith({
      entity_type: 'DOCUMENT',
      entity_id: 'source-file',
      property_id: '00000001-0000-0000-0000-000000000013',
      body: {
        value: {
          type: 'multi_entity_reference',
          references: [{ entity_type: 'CONTACT', entity_id: 'contact' }],
        },
      },
    });
    expect(properties.setEntityProperty).not.toHaveBeenCalled();
  });
});
