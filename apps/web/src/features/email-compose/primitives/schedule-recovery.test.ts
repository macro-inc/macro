import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { EmailDraftLifecycleState } from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';
import { createEmailSendSchedule } from './email-send-schedule';

const sendTime = '2026-12-01T12:00:00Z';
const scheduled = (
  deliveryStatus: 'pending' | 'sending' | 'failed' | 'unconfirmed'
): EmailDraftLifecycleState => ({
  type: 'scheduled',
  draftId: 'draft',
  threadId: 'thread',
  inboxId: 'inbox',
  observedAt: Date.now(),
  sendTime,
  deliveryStatus,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['standalone', 'reply'] as const)(
  '%s preserves an uncertain delivery from its initial draft before refreshing',
  async (kind) => {
    const context = createComposeContext();
    const draft = message('draft', {
      is_draft: true,
      scheduled_send_time: sendTime,
      scheduled_send_status: 'unconfirmed',
    });
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context, undefined, { draft })
        : mountReplyComposer(context, undefined, { draft });
    try {
      const state =
        'state' in root
          ? root.state.context.schedule
          : {
              state: root.scheduleState,
              pickerDisabled: root.schedulePickerDisabled,
              onCancel: root.cancelSchedule,
            };
      expect(state.state()).toMatchObject({ deliveryStatus: 'unconfirmed' });
      expect(state.pickerDisabled()).toBe(true);
      expect(await state.onCancel()).toBe(false);
      expect(context.delivery.unschedule).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);

it.each(['sending', 'failed', 'unconfirmed'] as const)(
  'replaces a local time proposal when delivery becomes %s without changing its send time',
  async (status) => {
    const context = createComposeContext();
    const { schedule, dispose } = createRoot((dispose) => ({
      dispose,
      schedule: createEmailSendSchedule({
        delivery: context.delivery,
        notices: context.notices,
        draftId: () => 'draft',
        threadId: () => 'thread',
        inboxId: () => 'inbox',
        saveDraft: vi.fn(),
        generation: () => 'one',
        includeSignature: () => undefined,
      }),
    }));
    try {
      schedule.observe(scheduled('pending'));
      const proposed = new Date('2026-12-02T12:00:00Z');
      expect(schedule.select(proposed)).toBe(true);
      schedule.observe(scheduled('pending'));
      expect(schedule.selectedTime()).toEqual(proposed);
      schedule.observe(scheduled(status));
      expect(schedule.state()).toEqual({
        type: 'scheduled',
        confirmedTime: new Date(sendTime),
        deliveryStatus: status,
      });
      expect(schedule.select(proposed)).toBe(false);
      expect(schedule.pickerDisabled()).toBe(true);
      expect(await schedule.submit()).toBe(false);
      expect(await schedule.cancel()).toBe(status === 'failed');
      expect(context.delivery.unschedule).toHaveBeenCalledTimes(
        status === 'failed' ? 1 : 0
      );
      expect(context.delivery.schedule).not.toHaveBeenCalled();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  }
);

it.each(['standalone', 'reply'] as const)(
  '%s refreshes recovery status, keeps uncertain delivery locked, and restores a confirmed failure',
  async (kind) => {
    const context = createComposeContext();
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context)
        : mountReplyComposer(context);
    const schedule =
      'state' in root
        ? root.state.context.schedule
        : {
            state: root.scheduleState,
            pickerDisabled: root.schedulePickerDisabled,
            onSelect: root.handleSendTimeChange,
            onCancel: root.cancelSchedule,
            onCheckStatus: root.checkScheduleStatus,
          };
    const editingDisabled =
      'state' in root ? root.state.context.disabled : root.editingDisabled;
    try {
      root.edit('Keep the scheduled message');
      await vi.advanceTimersByTimeAsync(600);
      context.setDraftLifecycle(scheduled('pending'));
      await vi.advanceTimersByTimeAsync(0);
      expect(schedule.onSelect(new Date('2026-12-02T12:00:00Z'))).toBe(true);
      context.setDraftLifecycle(scheduled('unconfirmed'));
      await vi.advanceTimersByTimeAsync(0);
      expect(schedule.state()).toMatchObject({
        type: 'scheduled',
        deliveryStatus: 'unconfirmed',
        confirmedTime: new Date(sendTime),
      });
      expect(schedule.pickerDisabled()).toBe(true);
      expect(editingDisabled()).toBe(true);
      expect(await schedule.onCancel()).toBe(false);
      const lifecycle = vi.mocked(context.draftLifecycle.observe).mock
        .results[0].value;
      const failure = new Error('Offline');
      vi.mocked(lifecycle.refresh).mockRejectedValueOnce(failure);
      await schedule.onCheckStatus?.();
      expect(context.notices.reportError).toHaveBeenCalledWith(failure);
      expect(schedule.state()).toMatchObject({ deliveryStatus: 'unconfirmed' });

      vi.mocked(lifecycle.refresh).mockImplementationOnce(async () => {
        const next = scheduled('failed');
        context.setDraftLifecycle(next);
        return next;
      });
      await schedule.onCheckStatus?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(schedule.state()).toMatchObject({ deliveryStatus: 'failed' });
      expect(schedule.pickerDisabled()).toBe(true);
      expect(await schedule.onCancel()).toBe(true);
      expect(schedule.state().type).toBe('editing');
      expect(editingDisabled()).toBe(false);
      expect(context.delivery.unschedule).toHaveBeenCalledOnce();
      expect(context.delivery.schedule).not.toHaveBeenCalled();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);
