import { $createListItemNode, $createListNode } from '@lexical/list';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { $createTextNode, $getNodeByKey, $getRoot } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  applyChecklistDom,
  clearChecklistDom,
} from '../plugins/checklist-controls/applyChecklistDom';
import { $collectChecklistMeta } from '../plugins/checklist-controls/collect';
import {
  type ChecklistItemMeta,
  countActiveFilters,
  dueBucket,
  type EffectiveItem,
  effectiveItem,
  itemMatchesFilters,
  normalizeSettings,
  parseMarkerPriority,
  planChecklist,
  type TaskListFilters,
} from '../plugins/checklist-controls/model';
import { behaviorEditor } from './editor';

const NOW = new Date(2030, 4, 14, 12);
const day = (date: number) => new Date(2030, 4, date, 0).toISOString();
const RAW: ChecklistItemMeta = {
  key: 'item',
  leadingKeys: ['leading'],
  attachedKeys: ['attached'],
  checked: false,
  text: 'Work',
  markerPriority: 'urgent',
  taskId: 'task',
  mentionAssignees: [{ id: 'inline-person', name: 'Inline person' }],
  mentionDue: day(15),
};
function item(patch: Partial<EffectiveItem> = {}): EffectiveItem {
  return {
    key: 'item',
    leadingKeys: [],
    attachedKeys: [],
    text: 'Work',
    checked: false,
    status: 'in-progress',
    priority: null,
    assignees: [{ id: 'person-a', name: 'Person A' }],
    due: day(14),
    ...patch,
  };
}
function filters(patch: Partial<TaskListFilters> = {}): TaskListFilters {
  return { status: [], priority: [], assignees: [], due: [], ...patch };
}

describe('checklist control planning', () => {
  it.each([
    { name: 'missing', due: null, bucket: 'none' },
    { name: 'invalid', due: 'not-a-date', bucket: 'none' },
    { name: 'yesterday', due: day(13), bucket: 'overdue' },
    { name: 'same calendar day', due: day(14), bucket: 'today' },
    { name: 'tomorrow', due: day(15), bucket: 'week' },
    { name: 'seventh day', due: day(21), bucket: 'week' },
    { name: 'eighth day', due: day(22), bucket: 'later' },
  ])('buckets $name due dates by calendar day', ({ due, bucket }) => {
    expect(dueBucket(due, NOW)).toBe(bucket);
  });

  it.each([
    { name: 'no marker', text: 'Work', priority: null },
    { name: 'internal marker', text: 'Work ! remains', priority: null },
    { name: 'one marker', text: 'Work!', priority: 'medium' },
    { name: 'two markers', text: 'Work!!', priority: 'high' },
    { name: 'three markers', text: 'Work!!!', priority: 'urgent' },
    { name: 'four markers', text: 'Work!!!!', priority: 'urgent' },
    { name: 'trailing whitespace', text: 'Work!!  \n', priority: 'high' },
  ])('parses $name priority suffixes', ({ text, priority }) => {
    expect(parseMarkerPriority(text)).toBe(priority);
  });

  it('resolves conflicting real task properties ahead of inline metadata', () => {
    const raw = { ...RAW, checked: true };
    const before = JSON.stringify(raw);
    const resolve = vi.fn((id: string) => `Resolved ${id}`);
    const merged = effectiveItem(
      raw,
      {
        statusOptionId: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
        priorityOptionId: PROPERTY_OPTION_IDS.PRIORITY.LOW,
        assigneeIds: ['task-person'],
        due: day(22),
      },
      resolve
    );
    expect(merged).toMatchObject({
      key: 'item',
      leadingKeys: ['leading'],
      attachedKeys: ['attached'],
      text: 'Work',
      checked: true,
      status: 'in-progress',
      priority: 'low',
      assignees: [{ id: 'task-person', name: 'Resolved task-person' }],
      due: day(22),
    });
    expect(resolve).toHaveBeenCalledExactlyOnceWith('task-person');
    expect(JSON.stringify(raw)).toBe(before);
  });

  it.each([true, false])(
    'falls back to checkbox checked=%s and inline metadata without task data',
    (checked) => {
      const resolve = vi.fn();
      expect(
        effectiveItem({ ...RAW, checked }, undefined, resolve)
      ).toMatchObject({
        status: checked ? 'done' : 'not-started',
        checked,
        priority: 'urgent',
        assignees: RAW.mentionAssignees,
        due: day(15),
      });
      expect(resolve).not.toHaveBeenCalled();
    }
  );

  it('falls back for unknown task options, empty assignees and a null task due date', () => {
    expect(
      effectiveItem(
        { ...RAW, checked: true },
        {
          statusOptionId: 'unknown-status',
          priorityOptionId: 'unknown-priority',
          assigneeIds: [],
          due: null,
        },
        () => 'Unused'
      )
    ).toMatchObject({
      status: 'done',
      priority: 'urgent',
      assignees: RAW.mentionAssignees,
      due: day(15),
    });
  });

  it.each([
    {
      name: 'empty filters',
      selected: filters(),
      assignees: ['person-a'],
      matches: true,
    },
    {
      name: 'OR within every dimension',
      selected: filters({
        status: ['done', 'in-progress'],
        priority: ['high', 'none'],
        assignees: ['person-b', 'person-a'],
        due: ['today', 'overdue'],
      }),
      assignees: ['person-a'],
      matches: true,
    },
    {
      name: 'status rejection',
      selected: filters({
        status: ['done'],
        priority: ['none'],
        assignees: ['person-a'],
        due: ['today'],
      }),
      assignees: ['person-a'],
      matches: false,
    },
    {
      name: 'priority rejection',
      selected: filters({
        status: ['in-progress'],
        priority: ['high'],
        assignees: ['person-a'],
        due: ['today'],
      }),
      assignees: ['person-a'],
      matches: false,
    },
    {
      name: 'assigned versus unassigned',
      selected: filters({
        status: ['in-progress'],
        priority: ['none'],
        assignees: ['unassigned'],
        due: ['today'],
      }),
      assignees: ['person-a'],
      matches: false,
    },
    {
      name: 'due rejection',
      selected: filters({
        status: ['in-progress'],
        priority: ['none'],
        assignees: ['person-a'],
        due: ['later'],
      }),
      assignees: ['person-a'],
      matches: false,
    },
    {
      name: 'unassigned match',
      selected: filters({ assignees: ['unassigned'] }),
      assignees: [],
      matches: true,
    },
    {
      name: 'unassigned rejection',
      selected: filters({
        status: ['in-progress'],
        priority: ['none'],
        assignees: ['person-a'],
        due: ['today'],
      }),
      assignees: [],
      matches: false,
    },
  ])(
    'applies $name with AND across dimensions',
    ({ selected, assignees, matches }) => {
      expect(
        itemMatchesFilters(
          item({ assignees: assignees.map((id) => ({ id, name: id })) }),
          selected,
          NOW
        )
      ).toBe(matches);
    }
  );

  it('counts selected filter choices rather than nonempty dimensions', () => {
    expect(
      countActiveFilters(
        filters({
          status: ['done', 'in-progress'],
          priority: ['none'],
          assignees: ['person-b', 'person-a'],
          due: ['today', 'overdue'],
        })
      )
    ).toBe(7);
  });

  it.each([false, true])(
    'keeps wrapper ordering and total progress independent of filtering=%s',
    (active) => {
      const items = [
        item({
          key: 'empty',
          text: '',
          checked: true,
          status: 'done',
          assignees: [],
        }),
        item({
          key: 'open',
          status: 'not-started',
          leadingKeys: ['before'],
          attachedKeys: ['after'],
        }),
        item({ key: 'canceled', status: 'canceled' }),
        item({ key: 'done', status: 'done' }),
        item({ key: 'checked', checked: true, status: 'in-progress' }),
      ];
      const plan = planChecklist(
        items,
        normalizeSettings(active ? { filters: { status: ['done'] } } : null),
        NOW
      );
      expect(plan.active).toBe(active);
      expect(plan.progress).toEqual({ done: 3, total: 4 });
      expect(plan.rows).toEqual([
        { key: 'empty', dimmed: false },
        { key: 'before', dimmed: active },
        { key: 'open', dimmed: active },
        { key: 'after', dimmed: active },
        { key: 'canceled', dimmed: active },
        { key: 'done', dimmed: false },
        { key: 'checked', dimmed: active },
      ]);
    }
  );

  it('keeps an empty filtered plan active with zero progress', () => {
    expect(
      planChecklist([], normalizeSettings({ filters: { due: ['today'] } }), NOW)
    ).toEqual({ rows: [], active: true, progress: { done: 0, total: 0 } });
  });
});

describe('checklist DOM plan application', () => {
  it('applies and clears dimming on actual mounted rows without changing saved state', () => {
    const { editor } = behaviorEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(true).append($createTextNode('done')),
            $createListItemNode(false).append($createTextNode('open'))
          )
        );
      },
      { discrete: true }
    );
    const meta = Object.values(editor.read($collectChecklistMeta))[0];
    const items = meta.items.map((row) =>
      effectiveItem(row, undefined, (id) => id)
    );
    const rows = items.map((row) => editor.getElementByKey(row.key));
    rows.forEach((row) => row?.classList.add('fixture-preserved'));
    const saved = editor.getEditorState().toJSON();
    applyChecklistDom(
      editor,
      planChecklist(
        items,
        normalizeSettings({ filters: { status: ['done'] } }),
        NOW
      )
    );
    expect(rows.map((row) => row?.classList.contains('mdtl-dim'))).toEqual([
      false,
      true,
    ]);
    applyChecklistDom(
      editor,
      planChecklist(
        items,
        normalizeSettings({ filters: { status: ['not-started'] } }),
        NOW
      )
    );
    expect(rows.map((row) => row?.classList.contains('mdtl-dim'))).toEqual([
      true,
      false,
    ]);
    clearChecklistDom(
      editor,
      items.map((row) => row.key)
    );
    expect(rows.map((row) => row?.classList.contains('mdtl-dim'))).toEqual([
      false,
      false,
    ]);
    expect(
      rows.every((row) => row?.classList.contains('fixture-preserved'))
    ).toBe(true);
    expect(editor.getEditorState().toJSON()).toEqual(saved);
  });

  it('ignores stale row keys after deletion without modifying the remaining model', () => {
    const { editor } = behaviorEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(false).append($createTextNode('removed')),
            $createListItemNode(false).append($createTextNode('remaining'))
          )
        );
      },
      { discrete: true }
    );
    const meta = Object.values(editor.read($collectChecklistMeta))[0];
    const items = meta.items.map((row) =>
      effectiveItem(row, undefined, (id) => id)
    );
    const oldPlan = planChecklist(
      items,
      normalizeSettings({ filters: { status: ['done'] } }),
      NOW
    );
    editor.update(() => $getNodeByKey(items[0].key)?.remove(), {
      discrete: true,
    });
    const saved = editor.getEditorState().toJSON();
    applyChecklistDom(editor, oldPlan);
    const remaining = editor.getElementByKey(items[1].key);
    expect(editor.getElementByKey(items[0].key)).toBeNull();
    expect(remaining?.classList.contains('mdtl-dim')).toBe(true);
    clearChecklistDom(editor, [items[0].key, 'unknown-key', items[1].key]);
    expect(remaining?.classList.contains('mdtl-dim')).toBe(false);
    expect(editor.getEditorState().toJSON()).toEqual(saved);
  });
});
