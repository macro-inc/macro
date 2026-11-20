import { describe, expect, it } from 'vitest';
import { projectMenuGroups } from './project-menu';

const surface = {
  splits: true,
  tabs: false,
  share: true,
  status: true,
  priority: true,
};

describe('projectMenuGroups', () => {
  it('offers every action to a single owned project', () => {
    expect(projectMenuGroups([{ access: 'owner' }], surface)).toEqual([
      ['open-in-split'],
      ['share'],
      ['copy-link', 'copy-id'],
      ['rename', 'status', 'priority'],
      ['delete'],
    ]);
  });

  it('lets editors change but not delete a project', () => {
    expect(projectMenuGroups([{ access: 'edit' }], surface)).toEqual([
      ['open-in-split'],
      ['share'],
      ['copy-link', 'copy-id'],
      ['rename', 'status', 'priority'],
    ]);
  });

  it.each(['view', 'comment', undefined] as const)(
    'keeps %s access to navigation and links',
    (access) => {
      expect(projectMenuGroups([{ access }], surface)).toEqual([
        ['open-in-split'],
        ['share'],
        ['copy-link', 'copy-id'],
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

  it('keeps appearance with edits after copy when the host offers it', () => {
    expect(
      projectMenuGroups([{ access: 'owner' }], {
        ...surface,
        appearance: true,
      })
    ).toEqual([
      ['open-in-split'],
      ['share'],
      ['copy-link', 'copy-id'],
      ['rename', 'change-icon', 'status', 'priority'],
      ['delete'],
    ]);
  });

  it('offers a new tab beside a new split for one project', () => {
    const tabs = { ...surface, tabs: true };
    expect(projectMenuGroups([{ access: 'view' }], tabs)).toEqual([
      ['open-in-split', 'open-in-tab'],
      ['share'],
      ['copy-link', 'copy-id'],
    ]);
    expect(
      projectMenuGroups([{ access: 'view' }, { access: 'view' }], tabs)
    ).toEqual([]);
  });

  it('omits entries the surface cannot offer without leaving empty groups', () => {
    const limited = {
      splits: false,
      tabs: false,
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
      ['copy-link', 'copy-id'],
      ['rename', 'priority'],
    ]);
  });
});
