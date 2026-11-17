import { expect, it, vi } from 'vitest';
import { DAY_DRAFT_ID } from '../core/day-draft';
import { dispatchDayDraftTimeChange } from './dispatch-day-draft-time-change';

it('routes only the unsaved resize to the bound composer and never to persisted mutations', () => {
  const resize = vi.fn(() => true);
  const persisted = vi.fn();
  const revert = vi.fn();
  const start = new Date('2030-07-01T10:00:00Z');
  const end = new Date('2030-07-01T11:00:00Z');
  const change = { event: { id: DAY_DRAFT_ID, start, end }, revert };

  dispatchDayDraftTimeChange(change, 'resize', { resize }, persisted);
  expect(resize).toHaveBeenCalledWith({ start, end });
  expect(persisted).not.toHaveBeenCalled();
  expect(revert).not.toHaveBeenCalled();

  resize.mockReturnValueOnce(false);
  dispatchDayDraftTimeChange(change, 'resize', { resize }, persisted);
  expect(revert).toHaveBeenCalledOnce();
  dispatchDayDraftTimeChange(change, 'drag', { resize }, persisted);
  expect(revert).toHaveBeenCalledTimes(2);
  dispatchDayDraftTimeChange(change, 'resize', undefined, persisted);
  expect(revert).toHaveBeenCalledTimes(3);
  expect(persisted).not.toHaveBeenCalled();

  dispatchDayDraftTimeChange(
    { ...change, jsEvent: { type: 'touchcancel' } },
    'resize',
    { resize },
    persisted
  );
  expect(revert).toHaveBeenCalledTimes(4);

  dispatchDayDraftTimeChange(
    { event: { id: 'persisted', start, end }, revert },
    'resize',
    { resize },
    persisted
  );
  expect(persisted).toHaveBeenCalledOnce();
  expect(resize).toHaveBeenCalledTimes(2);
});
