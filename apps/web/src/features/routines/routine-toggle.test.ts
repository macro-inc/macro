import { toast } from '@core/component/Toast/Toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineRow } from './core/types';
import { toggleRoutine } from './routine-toggle';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn() },
}));

const row: RoutineRow = {
  id: 'mine',
  name: 'Morning briefing',
  createdAt: '',
  when: 'Weekdays at 9:00 AM',
  whenKind: 'schedule',
  does: 'Sum up my day',
  ai: 'Ask AI',
  group: 'schedule',
  status: 'Active',
  enabled: true,
  editable: true,
  children: [],
  pausedByParent: false,
};

type Notice = {
  subtext: string;
  actions: { label: string; onClick(): void }[];
};

beforeEach(() => vi.mocked(toast.success).mockClear());

describe('switching a routine from its card', () => {
  it('turns it off and offers Undo, which turns it back on', () => {
    const source = { setEnabled: vi.fn() };
    toggleRoutine(source, row, { undo: true });
    expect(source.setEnabled).toHaveBeenCalledWith('mine', false);
    const [title, options] = vi.mocked(toast.success).mock.calls[0]!;
    expect(title).toBe('Morning briefing is off');
    const notice = options as unknown as Notice;
    expect(notice.subtext).toBe('Its settings and past runs are kept');
    expect(notice.actions.map((action) => action.label)).toEqual(['Undo']);
    notice.actions[0]!.onClick();
    expect(source.setEnabled).toHaveBeenLastCalledWith('mine', true);
  });

  it('turns it on without a notice', () => {
    const source = { setEnabled: vi.fn() };
    toggleRoutine(source, { ...row, enabled: false }, { undo: true });
    expect(source.setEnabled).toHaveBeenCalledWith('mine', true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('says nothing where the list has no Undo', () => {
    const source = { setEnabled: vi.fn() };
    toggleRoutine(source, row, { undo: false });
    expect(source.setEnabled).toHaveBeenCalledWith('mine', false);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
