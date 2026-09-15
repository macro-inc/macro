import { describe, expect, it } from 'vitest';
import { buildTagTree, type TreeTag } from './tag-tree';

const tag = (
  id: string,
  label: string,
  scope: 'user' | 'team' = 'user'
): TreeTag => ({
  id,
  label,
  scope,
  propertyDefinitionId: scope,
  color: '#123456',
});

describe('buildTagTree', () => {
  it('keeps deeper paths in child labels and attaches actual parent tags', () => {
    const child = tag('acme', 'Work/Customers/Acme');
    const parent = tag('work', 'Work');
    const tree = buildTagTree([
      child,
      tag('beta', 'Work/Customers/Beta'),
      parent,
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].tag).toBe(parent);
    expect(tree[0].children.map((node) => node.name)).toEqual([
      'Customers/Acme',
      'Customers/Beta',
    ]);
    expect(tree[0].children[0].tag).toBe(child);
    expect(tree[0].children.every((node) => node.children.length === 0)).toBe(
      true
    );
  });

  it('keeps a child and its deeper tags independently selectable at the same level', () => {
    const tree = buildTagTree([
      tag('soupio', 'feature/soupio'),
      tag('dink', 'feature/soupio/dink'),
    ]);
    expect(tree[0].children.map((node) => [node.name, node.tag?.id])).toEqual([
      ['soupio', 'soupio'],
      ['soupio/dink', 'dink'],
    ]);
    expect(tree[0].children.every((node) => node.children.length === 0)).toBe(
      true
    );
  });

  it('keeps scopes separate and preserves first appearance order', () => {
    const tree = buildTagTree([
      tag('z', 'Zebra/Child'),
      tag('a', 'Alpha'),
      tag('team-z', 'Zebra/Child', 'team'),
    ]);
    expect(tree.map((node) => node.name)).toEqual(['Zebra', 'Alpha', 'Zebra']);
    expect(tree[0].id).not.toBe(tree[2].id);
    expect(tree[2].children[0].tag?.id).toBe('team-z');
  });

  it('keeps malformed paths visible verbatim and does not mutate the input', () => {
    const names = ['/Work', 'Work/', 'Work//Child', 'Work/ /Child'];
    const tags = names.map((name) => Object.freeze(tag(name, name)));
    expect(buildTagTree(Object.freeze(tags)).map((node) => node.name)).toEqual(
      names
    );
    expect(buildTagTree([])).toEqual([]);
  });
});
