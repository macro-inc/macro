import { describe, expect, it } from 'vitest';
import { projectMenuGroups } from './project-menu';

const surface = { splits: true, share: true, status: true, priority: true };

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

  it('omits entries the surface cannot offer without leaving empty groups', () => {
    const limited = {
      splits: false,
      share: false,
      status: false,
      priority: false,
    };
    expect(projectMenuGroups([{ access: 'view' }], limited)).toEqual([
      ['copy-link', 'copy-id'],
    ]);
    expect(
      projectMenuGroups([{ access: 'owner' }, { access: 'owner' }], limited)
    ).toEqual([['delete']]);
    expect(
      projectMenuGroups([{ access: 'edit' }], { ...limited, priority: true })
    ).toEqual([
      ['rename', 'priority'],
      ['copy-link', 'copy-id'],
    ]);
  });
});
