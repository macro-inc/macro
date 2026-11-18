import type { EntityData } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { describe, expect, it } from 'vitest';
import type { SoupEntityActionItem } from '../createSoupEntityActions';
import { groupSoupEntityActions } from './group-soup-entity-actions';

const item = (id: string): SoupEntityActionItem => ({
  id,
  label: id,
  onClick: () => {},
});
const entity = (type: EntityData['type']) =>
  ({ id: 'one', type }) as EntityData;

describe('Soup action groups', () => {
  it('keeps copy variants together before modifiers and Delete last without cloning getters', () => {
    const copy = item('copy-link');
    const submenu = item('change-icon');
    Object.defineProperty(submenu, 'menuItem', { get: () => () => null });
    const actions = [
      item('delete'),
      submenu,
      item('copy-entity-id'),
      item('share'),
      item('copy-github-link'),
      item('mute'),
      item('open-in-split'),
      copy,
      item('download'),
      item('copy-branch-name'),
    ];
    const groups = groupSoupEntityActions(actions, entity('document'));

    expect(groups.map(({ id }) => id)).toEqual([
      'open',
      'most-used',
      'copy',
      'modify',
      'share-export',
      'state',
      'delete',
    ]);
    expect(groups.find(({ id }) => id === 'copy')?.items).toEqual([
      actions[2],
      actions[4],
      copy,
      actions[9],
    ]);
    expect(groups.find(({ id }) => id === 'modify')?.items[0]).toBe(submenu);
    expect(groups.at(-1)?.items).toEqual([actions[0]]);
  });

  it('promotes only actions for the selected entity, never mixed selections', () => {
    const actions = [
      item('favorite'),
      item('share'),
      item('mark-done'),
      item(`set-${SYSTEM_PROPERTY_IDS.ASSIGNEES}`),
      item('ask-macro'),
      item('create-reminder'),
      item('mark-notifications-read'),
    ];
    const ids = (selected?: EntityData, task = false) =>
      groupSoupEntityActions(actions, selected, task)
        .find(({ id }) => id === 'most-used')
        ?.items.map((action) => action.id);

    expect(ids(entity('document'))).toEqual(['favorite', 'share', 'ask-macro']);
    expect(ids(entity('document'), true)).toEqual([
      'share',
      'mark-done',
      `set-${SYSTEM_PROPERTY_IDS.ASSIGNEES}`,
    ]);
    expect(ids(entity('channel'))).toEqual([
      'favorite',
      'ask-macro',
      'mark-notifications-read',
    ]);
    expect(ids(entity('email'))).toEqual(['mark-done', 'create-reminder']);
    expect(ids()).toBeUndefined();
  });

  it('keeps generated task and CRM fields in Modify and company hide in State', () => {
    const groups = groupSoupEntityActions(
      [
        item('set-stage'),
        item('set-owner'),
        item('set-revenue'),
        item(`set-${SYSTEM_PROPERTY_IDS.STATUS}`),
        item(`set-${SYSTEM_PROPERTY_IDS.PRIORITY}`),
        item('hide-company'),
      ],
      entity('crm_company')
    );
    expect(groups.map(({ id }) => id)).toEqual(['modify', 'state']);
    expect(groups[0]?.items).toHaveLength(5);
  });
});
