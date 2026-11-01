import type { EntityItem } from '@core/context/quickAccess';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rankMentions } from './mention-ranking';
import { sortMobileMentions } from './mobileSort';

const NOW = new Date('2026-10-01T12:00:00Z');
const OLD = new Date('2026-08-01T12:00:00Z');

function item(
  id: string,
  name: string,
  bucket: 'task' | 'initiative',
  viewedAt = NOW
): EntityItem {
  return {
    id,
    kind: 'entity',
    bucket,
    searchText: name,
    sortTimestamp: viewedAt.getTime(),
    timestamps: { viewedAt },
    data:
      bucket === 'initiative'
        ? { id, name, ownerId: 'owner', type: 'initiative' }
        : {
            id,
            name,
            ownerId: 'owner',
            type: 'document',
            fileType: 'md',
            subType: { type: 'task' },
          },
  };
}

afterEach(() => vi.useRealTimers());

describe('mention ranking', () => {
  it('promotes an old project appended after hundreds of recent cached tasks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const tasks = Array.from({ length: 500 }, (_, index) =>
      item(`task-${index}`, `Track task changes ${index}`, 'task')
    );
    const project = item('project', 'Task planning', 'initiative', OLD);
    const source = [...tasks, project];

    for (const query of ['task', ' TASK ', 'task p', 'task planning']) {
      expect(rankMentions(source, query, true)[0]).toBe(project);
      expect(sortMobileMentions(source, query, [], true)[0]).toBe(project);
    }
    expect(source.at(-1)).toBe(project);
  });

  it('lets an exact task name beat a project that only partially matches', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const task = item('task', 'Release', 'task', OLD);
    const project = item('project', 'Release planning', 'initiative');
    expect(rankMentions([project, task], 'release')[0]).toBe(task);
  });

  it('uses a project boost for equally strong name matches', () => {
    const task = item('task', 'Roadmap', 'task');
    const project = item('project', 'Roadmap', 'initiative');
    expect(rankMentions([task, project], 'road')[0]).toBe(project);
  });

  it('uses viewed recency when browsing and when name matches are equal', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const old = item('old', 'Task planning', 'initiative', OLD);
    const recent = item('recent', 'Task planning', 'task');
    expect(rankMentions([old, recent], '')[0]).toBe(recent);
    const olderTask = item('older-task', 'Task planning', 'task', OLD);
    expect(rankMentions([olderTask, recent], 'task')[0]).toBe(recent);
  });

  it('preserves broader cache matches and their identity without admitting unrelated custom items', () => {
    const broad = item('broad', 'Some early afternoon music', 'task');
    const direct = item('direct', 'Seamu notes', 'initiative');
    expect(rankMentions([broad, direct], 'seamu')).toEqual([direct]);
    expect(rankMentions([broad, direct], 'seamu', true)).toEqual([
      direct,
      broad,
    ]);
    expect(sortMobileMentions([broad, direct], 'seamu', [], true)).toEqual([
      direct,
      broad,
    ]);
  });

  it('keeps equal scores stable as another source page arrives', () => {
    const first = item('first', 'Task update', 'task');
    const second = item('second', 'Task update', 'task');
    const third = item('third', 'Task update', 'task');
    expect(rankMentions([first, second], 'task')).toEqual([first, second]);
    expect(rankMentions([first, second, third], 'task')).toEqual([
      first,
      second,
      third,
    ]);
  });
});
