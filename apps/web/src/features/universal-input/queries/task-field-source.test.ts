import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type {
  ContactReferencePerson,
  ContactReferenceRequest,
} from '@queries/contacts/references';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { fieldsSchema } from '../core/input';
import { createTaskFieldSource } from './task-field-source';

const query = vi.hoisted(() => ({
  isSuccess: true,
  data: [] as PropertyDefinitionWithOptions[],
  refetch: vi.fn(),
}));
const references = vi.hoisted(() => ({
  lookup:
    vi.fn<(label: string) => readonly ContactReferencePerson[] | undefined>(),
  request: undefined as
    | Accessor<Omit<ContactReferenceRequest, 'secondaryInboxIds'>>
    | undefined,
  enabled: undefined as Accessor<boolean> | undefined,
}));
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: () => query,
}));
vi.mock('@queries/contacts/use-references', () => ({
  useContactReferences: (
    request: Accessor<Omit<ContactReferenceRequest, 'secondaryInboxIds'>>,
    enabled: Accessor<boolean>
  ) => {
    references.request = request;
    references.enabled = enabled;
    return { lookup: references.lookup };
  },
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({ useList: () => ({ items: () => [] }) }),
}));
vi.mock('@app/features/block-md/util/taskComposerProperties', () => ({
  defaultTaskPropertyValues: () => ({}),
}));

const ASSIGNEES: PropertyDefinitionWithOptions = {
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
};
beforeEach(() => {
  query.isSuccess = true;
  query.data = [];
  query.refetch.mockReset();
  references.lookup.mockReset();
  references.request = undefined;
  references.enabled = undefined;
});

it('feeds inferred dates into the task picker while preserving a cleared manual date', () => {
  createRoot((dispose) => {
    try {
      const fields = fieldsSchema.parse({ due_date: '2026-10-22' });
      const source = createTaskFieldSource(
        'me',
        () => fields,
        () => true
      );
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

it('loads a cold property catalog before supplying inference and creation metadata', async () => {
  await createRoot(async (dispose) => {
    try {
      query.isSuccess = false;
      query.refetch.mockResolvedValue({ isSuccess: true, data: [ASSIGNEES] });
      const source = createTaskFieldSource(
        'me',
        () => fieldsSchema.parse({}),
        () => true
      );
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
      const source = createTaskFieldSource('me');
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
      const fields = fieldsSchema.parse({ due_date: '2026-02-30' });
      const source = createTaskFieldSource(
        'me',
        () => fields,
        () => true
      );
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
      ).toEqual({ valueType: 'DATE', value: new Date('2026-02-28T12:00:00') });
    } finally {
      dispose();
    }
  });
});

it('resolves an off-window assignee from per-label evidence without requesting a people catalog', () => {
  query.data = [ASSIGNEES];
  references.lookup.mockReturnValue([
    {
      userId: 'macro|person99999@example.com',
      email: 'person99999@example.com',
      name: 'Person 99999',
    },
  ]);
  createRoot((dispose) => {
    try {
      const fields = fieldsSchema.parse({
        properties: JSON.stringify([
          { name: 'Assignees', values: ['person99999@example.com'] },
        ]),
      });
      const source = createTaskFieldSource(
        'me',
        () => fields,
        () => true
      );
      expect(references.request?.()).toEqual({
        labels: ['person99999@example.com'],
        matching: 'anyName',
        excludeSecondaryInboxes: true,
      });
      expect(source.values(fields)).toEqual({
        unresolved: [],
        values: {
          [SYSTEM_PROPERTY_IDS.ASSIGNEES]: {
            valueType: 'ENTITY',
            refs: [
              {
                entity_id: 'macro|person99999@example.com',
                entity_type: 'USER',
              },
            ],
          },
        },
      });
      expect(references.lookup).toHaveBeenCalledWith('person99999@example.com');
    } finally {
      dispose();
    }
  });
});

it('resolves an explicit authorized identity without requiring a display name', () => {
  query.data = [ASSIGNEES];
  references.lookup.mockReturnValue([
    {
      userId: 'macro|known@example.com',
      email: 'known@example.com',
      name: null,
    },
  ]);
  createRoot((dispose) => {
    try {
      const fields = fieldsSchema.parse({
        properties: JSON.stringify([
          { name: 'Assignees', values: ['macro|known@example.com'] },
        ]),
      });
      const source = createTaskFieldSource(
        'me',
        () => fields,
        () => true
      );
      expect(source.values(fields)).toEqual({
        unresolved: [],
        values: {
          [SYSTEM_PROPERTY_IDS.ASSIGNEES]: {
            valueType: 'ENTITY',
            refs: [
              { entity_id: 'macro|known@example.com', entity_type: 'USER' },
            ],
          },
        },
      });
    } finally {
      dispose();
    }
  });
});

it('keeps incomplete and ambiguous evidence unresolved rather than choosing a default assignee', () => {
  query.data = [ASSIGNEES];
  createRoot((dispose) => {
    try {
      const fields = fieldsSchema.parse({
        properties: JSON.stringify([{ name: 'Assignees', values: ['Shared'] }]),
      });
      const source = createTaskFieldSource(
        'me',
        () => fields,
        () => true
      );
      expect(source.values(fields).unresolved).toEqual(['Assignees']);
      references.lookup.mockReturnValue([
        {
          userId: 'macro|one@example.com',
          email: 'one@example.com',
          name: 'Shared',
        },
        {
          userId: 'macro|two@example.com',
          email: 'two@example.com',
          name: 'Shared Person',
        },
      ]);
      expect(source.values(fields).unresolved).toEqual(['Assignees']);
      expect(
        source.values(fields).values[SYSTEM_PROPERTY_IDS.ASSIGNEES]
      ).toBeUndefined();
      references.lookup.mockReturnValue([
        {
          userId: 'macro|two@example.com',
          email: 'two@example.com',
          name: 'Shared Person',
        },
      ]);
      expect(source.values(fields).unresolved).toEqual([]);
    } finally {
      dispose();
    }
  });
});

it('replaces current labels, retains model term boundaries, and skips inactive or manually overridden inference', () => {
  query.data = [ASSIGNEES];
  createRoot((dispose) => {
    try {
      const [fields, setFields] = createSignal(
        fieldsSchema.parse({
          properties: JSON.stringify([
            { name: '  Assignees ', values: ['Person, One'] },
          ]),
        })
      );
      const [enabled, setEnabled] = createSignal(true);
      const source = createTaskFieldSource('me', fields, enabled);
      expect(references.request?.().labels).toEqual(['Person, One']);
      setFields(
        fieldsSchema.parse({
          properties: JSON.stringify([
            { name: 'Assignees', values: ['Different Person'] },
          ]),
        })
      );
      expect(references.request?.().labels).toEqual(['Different Person']);
      setFields(
        fieldsSchema.parse({
          properties: JSON.stringify([
            { name: '  Assignees ', values: ['Person, One'] },
          ]),
          taskProperties: JSON.stringify({
            [SYSTEM_PROPERTY_IDS.ASSIGNEES]: { valueType: 'ENTITY', refs: [] },
          }),
        })
      );
      expect(references.request?.().labels).toEqual([]);
      expect(source.values(fields()).unresolved).toEqual([]);
      expect(
        source.values(fields()).values[SYSTEM_PROPERTY_IDS.ASSIGNEES]
      ).toEqual({ valueType: 'ENTITY', refs: [] });
      setEnabled(false);
      expect(references.enabled?.()).toBe(false);
      expect(references.request?.().labels).toEqual([]);
    } finally {
      dispose();
    }
  });
});

it('reports property catalog failures instead of creating with empty definitions', async () => {
  await createRoot(async (dispose) => {
    try {
      query.isSuccess = false;
      query.refetch.mockResolvedValue({
        isSuccess: false,
        error: new Error('Task fields unavailable'),
      });
      const source = createTaskFieldSource(
        'me',
        () => fieldsSchema.parse({}),
        () => true
      );
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
