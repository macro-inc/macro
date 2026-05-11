import { describe, expect, test } from 'bun:test';
import { planCreateIndex } from './create_indices';

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
