import { describe, expect, it } from 'vitest';
import { hiddenFiles, reviewFileGroups } from './file-groups';
import type { FileGroup } from './model';
import type { ReviewEntry } from './source';

const file = (path: string, labels: string[] = []): ReviewEntry => ({
  path,
  labels,
  content: path,
  status: 'added',
  added: 1,
  removed: 0,
});
describe('file visibility', () => {
  it('uses agent defaults, retains engine labels, and ignores files absent from this revision', () => {
    const groups = reviewFileGroups(
      [
        file('src/main.ts'),
        file('.sqlx/query.json', ['generated']),
        file('tests/main.ts', ['test']),
      ],
      [
        {
          key: 'generated',
          title: 'Generated metadata',
          hidden: true,
          files: ['.sqlx/query.json', 'gone.json'],
        },
      ]
    );
    expect(groups.map((group) => group.key)).toEqual(['generated', 'test']);
    expect([...hiddenFiles(groups, new Map())]).toEqual(['.sqlx/query.json']);
    expect([
      ...hiddenFiles(
        groups,
        new Map([
          ['generated', false],
          ['test', true],
        ])
      ),
    ]).toEqual(['tests/main.ts']);
  });
  it('keeps an overlapping file hidden until every hidden group is revealed', () => {
    const groups: FileGroup[] = ['generated', 'backend'].map((key) => ({
      key,
      title: key,
      files: ['schema.ts'],
      hidden: true,
    }));
    expect(
      hiddenFiles(groups, new Map([['generated', false]])).has('schema.ts')
    ).toBe(true);
    expect(
      hiddenFiles(
        groups,
        new Map([
          ['generated', false],
          ['backend', false],
        ])
      ).size
    ).toBe(0);
  });
  it('does not hide authored files again through automatic label groups', () => {
    const groups = reviewFileGroups(
      [
        file('.sqlx/query.json', ['generated']),
        file('schema.ts', ['generated']),
      ],
      [
        {
          key: 'sqlx',
          title: 'SQLx',
          files: ['.sqlx/query.json'],
          hidden: true,
        },
      ]
    );
    expect(groups[1]).toMatchObject({
      title: 'Other generated',
      files: ['schema.ts'],
    });
    expect([...hiddenFiles(groups, new Map([['sqlx', false]]))]).toEqual([
      'schema.ts',
    ]);
  });
});
