import { describe, expect, it } from 'vitest';
import { projectMenuGroups, projectMenuTargets } from './project-menu';

const surface = { splits: true, share: true };

describe('projectMenuTargets', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('acts on the selection when the clicked row is part of it', () => {
    expect(projectMenuTargets(rows[1], rows.slice(0, 2))).toEqual(
      rows.slice(0, 2)
    );
  });

  it('acts on the clicked row outside a selection or with one selected', () => {
    expect(projectMenuTargets(rows[2], rows.slice(0, 2))).toEqual([rows[2]]);
    expect(projectMenuTargets(rows[0], [rows[0]])).toEqual([rows[0]]);
    expect(projectMenuTargets(rows[0], [])).toEqual([rows[0]]);
  });
});

describe('projectMenuGroups', () => {
  it('offers every action to a single owned project', () => {
    expect(projectMenuGroups([{ access: 'owner' }], surface)).toEqual([
      ['open-in-split'],
      ['rename', 'status', 'priority'],
      ['copy-link', 'copy-id', 'share'],
      ['delete'],
    ]);
  });

  it('lets editors change but not delete a project', () => {
    expect(projectMenuGroups([{ access: 'edit' }], surface)).toEqual([
      ['open-in-split'],
      ['rename', 'status', 'priority'],
      ['copy-link', 'copy-id', 'share'],
    ]);
  });

  it.each(['view', 'comment', undefined] as const)(
    'keeps %s access to navigation and links',
    (access) => {
      expect(projectMenuGroups([{ access }], surface)).toEqual([
        ['open-in-split'],
        ['copy-link', 'copy-id', 'share'],
      ]);
    }
  );

  it('limits a selection to actions every project allows', () => {
    expect(
      projectMenuGroups([{ access: 'owner' }, { access: 'owner' }], surface)
    ).toEqual([['status', 'priority'], ['delete']]);
    expect(
      projectMenuGroups([{ access: 'owner' }, { access: 'edit' }], surface)
    ).toEqual([['status', 'priority']]);
    expect(
      projectMenuGroups([{ access: 'owner' }, { access: 'view' }], surface)
    ).toEqual([]);
  });

  it('omits split and share entries the surface cannot honor', () => {
    expect(
      projectMenuGroups([{ access: 'view' }], { splits: false, share: false })
    ).toEqual([['copy-link', 'copy-id']]);
  });
});
