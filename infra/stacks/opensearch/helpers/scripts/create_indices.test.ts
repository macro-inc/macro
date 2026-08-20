import { describe, expect, test } from 'bun:test';
import {
  INDEX_SPECS,
  planCreateIndex,
  planMappingConvergence,
  selectIndexSpecs,
} from './create_indices';

describe('planCreateIndex', () => {
  test('fresh env — index missing, alias free → create with alias', () => {
    const plan = planCreateIndex({
      indexExists: false,
      aliasExistsOnIndex: false,
      aliasNameIsPhysicalIndex: false,
      aliasTargets: [],
    });
    expect(plan.kind).toBe('create_with_alias');
  });

  test('index already in place with alias → noop', () => {
    const plan = planCreateIndex({
      indexExists: true,
      aliasExistsOnIndex: true,
      aliasNameIsPhysicalIndex: false,
      aliasTargets: ['__SELF__'],
    });
    expect(plan.kind).toBe('noop');
  });

  test('index exists, alias missing, alias free → add alias', () => {
    const plan = planCreateIndex({
      indexExists: true,
      aliasExistsOnIndex: false,
      aliasNameIsPhysicalIndex: false,
      aliasTargets: [],
    });
    expect(plan.kind).toBe('add_alias');
  });

  test('mid-migration: alias name is a bare physical index, new index missing → create without alias and defer', () => {
    const plan = planCreateIndex({
      indexExists: false,
      aliasExistsOnIndex: false,
      aliasNameIsPhysicalIndex: true,
      aliasTargets: [],
    });
    expect(plan.kind).toBe('create_without_alias');
    if (plan.kind === 'create_without_alias') {
      expect(plan.nextStep).toContain('reindex_with_alias_swap.ts');
    }
  });

  test('mid-migration: alias name is a bare physical index, new index already created → defer alias only', () => {
    const plan = planCreateIndex({
      indexExists: true,
      aliasExistsOnIndex: false,
      aliasNameIsPhysicalIndex: true,
      aliasTargets: [],
    });
    expect(plan.kind).toBe('defer_alias');
    if (plan.kind === 'defer_alias') {
      expect(plan.nextStep).toContain('reindex_with_alias_swap.ts');
    }
  });

  test('mid-migration: alias points at a different index (e.g. emails -> emails_v2), new index missing → create without alias', () => {
    const plan = planCreateIndex({
      indexExists: false,
      aliasExistsOnIndex: false,
      aliasNameIsPhysicalIndex: false,
      aliasTargets: ['emails_v2'],
    });
    expect(plan.kind).toBe('create_without_alias');
  });

  test('mid-migration: alias points at different index, new index already created → defer alias', () => {
    const plan = planCreateIndex({
      indexExists: true,
      aliasExistsOnIndex: false,
      aliasNameIsPhysicalIndex: false,
      aliasTargets: ['emails_v2'],
    });
    expect(plan.kind).toBe('defer_alias');
  });
});

describe('planMappingConvergence', () => {
  const TAG_PROPERTIES = {
    type: 'nested',
    properties: {
      definition_id: { type: 'keyword' },
      values: { type: 'keyword' },
    },
  };

  test('live mapping matches the body → nothing to do', () => {
    const plan = planMappingConvergence({
      desired: { entity_id: { type: 'keyword' }, properties: TAG_PROPERTIES },
      live: { entity_id: { type: 'keyword' }, properties: TAG_PROPERTIES },
    });
    expect(plan.missingPaths).toEqual([]);
    expect(plan.conflictPaths).toEqual([]);
    expect(plan.updates).toEqual({});
  });

  test('macro-2731: index predates the nested properties + name fields → add both', () => {
    const plan = planMappingConvergence({
      desired: {
        entity_id: { type: 'keyword' },
        name: {
          type: 'text',
          fields: { keyword: { type: 'keyword', ignore_above: 128 } },
        },
        properties: TAG_PROPERTIES,
      },
      live: { entity_id: { type: 'keyword' } },
    });
    expect(plan.missingPaths).toEqual(['name', 'properties']);
    expect(plan.conflictPaths).toEqual([]);
    expect(Object.keys(plan.updates)).toEqual(['name', 'properties']);
    expect(plan.updates.properties).toEqual(TAG_PROPERTIES);
  });

  test('a new member of an existing nested field is additive', () => {
    const plan = planMappingConvergence({
      desired: {
        properties: {
          type: 'nested',
          properties: {
            definition_id: { type: 'keyword' },
            values: { type: 'keyword' },
            date_value: { type: 'date' },
          },
        },
      },
      live: { properties: TAG_PROPERTIES },
    });
    expect(plan.missingPaths).toEqual(['properties.date_value']);
    expect(Object.keys(plan.updates)).toEqual(['properties']);
  });

  test('a new multi-field under an existing field is additive', () => {
    const plan = planMappingConvergence({
      desired: {
        channel_name: {
          type: 'text',
          fields: { keyword: { type: 'keyword', ignore_above: 128 } },
        },
      },
      live: { channel_name: { type: 'text' } },
    });
    expect(plan.missingPaths).toEqual(['channel_name.keyword']);
    expect(Object.keys(plan.updates)).toEqual(['channel_name']);
  });

  test('parameter-only differences are ignored so runs stay quiet', () => {
    const plan = planMappingConvergence({
      // OpenSearch echoes a normalized mapping: defaults like `index: true`
      // and `doc_values: true` come back omitted.
      desired: {
        channel_id: { type: 'keyword', index: true, doc_values: true },
      },
      live: { channel_id: { type: 'keyword' } },
    });
    expect(plan.missingPaths).toEqual([]);
    expect(plan.updates).toEqual({});
  });

  test('a changed type is reported, never applied', () => {
    const plan = planMappingConvergence({
      desired: { started_at_millis: { type: 'date', format: 'epoch_millis' } },
      live: { started_at_millis: { type: 'long' } },
    });
    expect(plan.conflictPaths).toEqual(['started_at_millis']);
    expect(plan.updates).toEqual({});
  });

  test('a conflict keeps its whole top-level field out of the update', () => {
    const plan = planMappingConvergence({
      desired: {
        properties: {
          type: 'nested',
          properties: {
            values: { type: 'keyword' },
            number_value: { type: 'double' },
          },
        },
      },
      live: {
        properties: {
          type: 'nested',
          properties: { values: { type: 'text' } },
        },
      },
    });
    expect(plan.missingPaths).toEqual(['properties.number_value']);
    expect(plan.conflictPaths).toEqual(['properties.values']);
    expect(plan.updates).toEqual({});
  });

  test('an index with no live mapping yet takes every field', () => {
    const plan = planMappingConvergence({
      desired: { entity_id: { type: 'keyword' } },
      live: undefined,
    });
    expect(plan.missingPaths).toEqual(['entity_id']);
    expect(Object.keys(plan.updates)).toEqual(['entity_id']);
  });
});

describe('selectIndexSpecs', () => {
  test('no filter runs every index', () => {
    expect(selectIndexSpecs(INDEX_SPECS, undefined)).toEqual(INDEX_SPECS);
  });

  test('filters by alias', () => {
    const selected = selectIndexSpecs(INDEX_SPECS, 'call_records');
    expect(selected.map((s) => s.indexName)).toEqual(['call_records_v2']);
  });

  test('filters by physical index name', () => {
    const selected = selectIndexSpecs(INDEX_SPECS, 'call_records_v2');
    expect(selected.map((s) => s.aliasName)).toEqual(['call_records']);
  });

  test('an unknown filter selects nothing so the caller can abort', () => {
    expect(selectIndexSpecs(INDEX_SPECS, 'nope')).toEqual([]);
  });
});
