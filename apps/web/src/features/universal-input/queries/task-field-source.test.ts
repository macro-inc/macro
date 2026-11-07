import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { fieldsSchema } from '../core/input';
import { createTaskFieldSource } from './task-field-source';

const query = vi.hoisted(() => ({
  isSuccess: true,
  data: [] as PropertyDefinitionWithOptions[],
  refetch: vi.fn(),
}));
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: () => query,
}));
beforeEach(() => {
  query.isSuccess = true;
  query.data = [];
  query.refetch.mockReset();
});
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({ useList: () => ({ items: () => [] }) }),
}));
vi.mock('@app/features/block-md/util/taskComposerProperties', () => ({
  defaultTaskPropertyValues: () => ({}),
}));

it('feeds inferred due dates into the standard task property picker while preserving a cleared manual date', () => {
  createRoot((dispose) => {
    try {
      const source = createTaskFieldSource('me', () => []);
      const fields = fieldsSchema.parse({ due_date: '2026-10-22' });
      expect(
        source.values(fields).values[SYSTEM_PROPERTY_IDS.DUE_DATE]
      ).toEqual({ valueType: 'DATE', value: new Date('2026-10-22T12:00:00') });
      fields.taskProperties = JSON.stringify({
        [SYSTEM_PROPERTY_IDS.DUE_DATE]: { valueType: 'DATE', value: null },
      });
      expect(
        source.values(fields).values[SYSTEM_PROPERTY_IDS.DUE_DATE]
      ).toEqual({ valueType: 'DATE', value: null });
    } finally {
      dispose();
    }
  });
});

it('loads a cold catalog through the shared query before supplying inference and creation metadata', async () => {
  await createRoot(async (dispose) => {
    try {
      query.isSuccess = false;
      const catalog: PropertyDefinitionWithOptions[] = [
        {
          definition: {
            id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
            display_name: 'Assignees',
            data_type: 'ENTITY',
            is_multi_select: true,
            specific_entity_type: 'USER',
            is_metadata: false,
            is_system: true,
            owner: { scope: 'system' },
            created_at: '',
            updated_at: '',
          },
          property_options: [],
        },
      ];
      query.refetch.mockResolvedValue({ isSuccess: true, data: catalog });
      const source = createTaskFieldSource('me', () => []);
      expect(await source.definitions()).toEqual([
        { name: 'Assignees', options: [] },
      ]);
      expect(
        (await source.createDefinitions()).get(SYSTEM_PROPERTY_IDS.ASSIGNEES)
          ?.is_multi_select
      ).toBe(true);
      expect(query.refetch).toHaveBeenCalledWith({ cancelRefetch: false });
    } finally {
      dispose();
    }
  });
});

it('creates with Companies and Contacts without offering them to extraction', async () => {
  await createRoot(async (dispose) => {
    try {
      const definition = (id: string, display_name: string) => ({
        definition: {
          id,
          display_name,
          data_type: 'ENTITY',
          is_multi_select: true,
          specific_entity_type: 'COMPANY',
          is_metadata: false,
          is_system: true,
          owner: { scope: 'system' },
          created_at: '',
          updated_at: '',
        },
        property_options: [],
      });
      query.isSuccess = false;
      query.refetch.mockResolvedValue({
        isSuccess: true,
        data: [
          definition(SYSTEM_PROPERTY_IDS.COMPANIES, 'Companies'),
          definition(SYSTEM_PROPERTY_IDS.CONTACTS, 'Contacts'),
        ],
      });
      const source = createTaskFieldSource('me', () => []);
      expect(await source.definitions()).toEqual([]);
      const definitions = await source.createDefinitions();
      expect(
        definitions.get(SYSTEM_PROPERTY_IDS.COMPANIES)?.is_multi_select
      ).toBe(true);
      expect(
        definitions.get(SYSTEM_PROPERTY_IDS.CONTACTS)?.is_multi_select
      ).toBe(true);
    } finally {
      dispose();
    }
  });
});

it('rejects impossible inferred due dates and permits a manual correction', () => {
  createRoot((dispose) => {
    try {
      const source = createTaskFieldSource('me', () => []);
      const fields = fieldsSchema.parse({ due_date: '2026-02-30' });
      expect(
        source.values(fields).values[SYSTEM_PROPERTY_IDS.DUE_DATE]
      ).toBeUndefined();
      expect(source.values(fields).unresolved).toContain('Due date');
      fields.taskProperties = JSON.stringify({
        [SYSTEM_PROPERTY_IDS.DUE_DATE]: {
          valueType: 'DATE',
          value: '2026-02-28T12:00:00',
        },
      });
      expect(source.values(fields).unresolved).toEqual([]);
      expect(
        source.values(fields).values[SYSTEM_PROPERTY_IDS.DUE_DATE]
      ).toEqual({
        valueType: 'DATE',
        value: new Date('2026-02-28T12:00:00'),
      });
    } finally {
      dispose();
    }
  });
});

it('keeps planner people resolution independent of the bounded Quick Access window', () => {
  query.data = [
    {
      definition: {
        id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
        display_name: 'Assignees',
        data_type: 'ENTITY',
        is_multi_select: true,
        specific_entity_type: 'USER',
        is_metadata: false,
        is_system: true,
        owner: { scope: 'system' },
        created_at: '',
        updated_at: '',
      },
      property_options: [],
    },
  ];
  createRoot((dispose) => {
    const people = Array.from({ length: 100 }, (_, index) => ({
      id: `macro|person${index}@example.com`,
      email: `person${index}@example.com`,
      name: `Person ${index}`,
    }));
    const source = createTaskFieldSource('me', () => people);
    const fields = fieldsSchema.parse({
      properties: JSON.stringify([
        { name: 'Assignees', values: ['person99@example.com'] },
      ]),
    });
    expect(source.values(fields).unresolved).toEqual([]);
    expect(JSON.stringify(source.values(fields).values)).toContain(
      'macro|person99@example.com'
    );
    dispose();
  });
});

it('reports a catalog failure instead of extracting or creating with empty definitions', async () => {
  await createRoot(async (dispose) => {
    try {
      query.isSuccess = false;
      query.refetch.mockResolvedValue({
        isSuccess: false,
        error: new Error('Task fields unavailable'),
      });
      const source = createTaskFieldSource('me', () => []);
      await expect(source.definitions()).rejects.toThrow(
        'Task fields unavailable'
      );
      await expect(source.createDefinitions()).rejects.toThrow(
        'Task fields unavailable'
      );
    } finally {
      dispose();
    }
  });
});
