import type { ModelOption } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { groupOptions, withoutRedundantGroups } from './model-groups';

const option = (
  id: string,
  name: string,
  group: string | null
): ModelOption => ({ id, name, description: null, group });

describe('withoutRedundantGroups', () => {
  it('drops a heading that only repeats its single member', () => {
    const options = [
      option('default', 'Auto', 'Auto'),
      option('opus-5', 'Claude Opus 5', 'Claude Opus'),
      option('opus-4.8', 'Claude Opus 4.8', 'Claude Opus'),
    ];

    expect(withoutRedundantGroups(options).map((o) => o.group)).toEqual([
      null,
      'Claude Opus',
      'Claude Opus',
    ]);
  });

  it('keeps a singleton heading that says something new', () => {
    const options = [option('sol', 'GPT-5.6 Sol', 'GPT')];

    expect(withoutRedundantGroups(options)[0]?.group).toBe('GPT');
  });

  it('keeps a heading shared by two members named after it', () => {
    const options = [option('a', 'Auto', 'Auto'), option('b', 'Auto', 'Auto')];

    expect(withoutRedundantGroups(options).map((o) => o.group)).toEqual([
      'Auto',
      'Auto',
    ]);
  });
});

describe('groupOptions', () => {
  it('buckets consecutive options under one heading', () => {
    const groups = groupOptions([
      option('default', 'Auto', null),
      option('opus-5', 'Claude Opus 5', 'Claude Opus'),
      option('opus-4.8', 'Claude Opus 4.8', 'Claude Opus'),
      option('kimi', 'Kimi K3', 'Kimi'),
    ]);

    expect(groups.map((g) => [g.label, g.options.length])).toEqual([
      [null, 1],
      ['Claude Opus', 2],
      ['Kimi', 1],
    ]);
  });
});
