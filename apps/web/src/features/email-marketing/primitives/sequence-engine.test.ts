import { describe, expect, it, vi } from 'vitest';
import type {
  MarketingRepository,
  SequenceDelivery,
} from '../context/contracts';
import type {
  Campaign,
  Enrollment,
  MarketingContact,
  MarketingSnapshot,
  SenderStatus,
} from '../core/model';
import { createSequenceEngine } from './sequence-engine';

const clock = new Date('2026-10-03T15:00:00Z');
const campaign: Campaign = {
  id: 'welcome',
  name: 'Welcome',
  description: '',
  status: 'active',
  senderId: 'gmail',
  updatedAt: clock.toISOString(),
  steps: [
    {
      id: 'first',
      delayDays: 0,
      subject: 'Hi {{firstName}}',
      body: 'Welcome {{name}}',
    },
    {
      id: 'second',
      delayDays: 2,
      subject: 'How is it going?',
      body: 'Reply to {{email}}',
    },
  ],
};
const contact: MarketingContact = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  crmContactId: 'crm-ada',
};
function setup(
  options: {
    now?: () => Date;
    senderStatus?: (id: string) => SenderStatus | undefined;
  } = {}
) {
  let ids = 0;
  let snapshot: MarketingSnapshot = {
    campaigns: [structuredClone(campaign)],
    enrollments: [],
    writable: true,
  };
  const saved: Enrollment[] = [];
  const repository: MarketingRepository = {
    load: vi.fn(async () => structuredClone(snapshot)),
    async saveCampaign(value) {
      snapshot.campaigns = [structuredClone(value)];
    },
    saveEnrollment: vi.fn(async (entry) => {
      saved.push(structuredClone(entry));
      snapshot.enrollments = [
        ...snapshot.enrollments.filter((value) => value.id !== entry.id),
        structuredClone(entry),
      ];
    }),
  };
  let draft = 0;
  const delivery: SequenceDelivery = {
    createDraft: vi.fn(async () => ({
      id: `draft-${++draft}`,
      generation: 0,
      threadId: `thread-${draft}`,
    })),
    schedule: vi.fn(async () => {}),
    cancel: vi.fn(async () => 'canceled' as const),
  };
  const engine = createSequenceEngine(repository, delivery, {
    now: options.now ?? (() => clock),
    id: () => (ids++ ? `enrollment-${ids}` : 'enrollment'),
    senderStatus: options.senderStatus,
  });
  return { repository, delivery, engine, saved, snapshot: () => snapshot };
}
const start = new Date('2026-10-03T16:00:00Z');

describe('server scheduled sequences', () => {
  it('reserves before sending, persists every handle before scheduling, and freezes personalized content', async () => {
    const test = setup();
    vi.mocked(test.delivery.schedule).mockImplementation(async (_, draft) => {
      expect(
        test.saved
          .at(-1)
          ?.steps.some(
            (step) =>
              step.draftId === draft.draftId &&
              step.draftGeneration === 0 &&
              step.status === 'scheduling'
          )
      ).toBe(true);
    });
    const enrollment = await test.engine.enroll(campaign, contact, start);
    expect(test.saved[0].status).toBe('preparing');
    expect(enrollment.status).toBe('scheduled');
    expect(test.delivery.schedule).toHaveBeenNthCalledWith(
      1,
      'gmail',
      { draftId: 'draft-1', generation: 0, threadId: 'thread-1' },
      '2026-10-03T16:00:00.000Z'
    );
    expect(test.delivery.schedule).toHaveBeenNthCalledWith(
      2,
      'gmail',
      { draftId: 'draft-2', generation: 0, threadId: 'thread-2' },
      '2026-10-05T16:00:00.000Z'
    );
    expect(enrollment.steps[0].subject).toBe('Hi Ada');
    expect(enrollment.steps[0].body).toContain('reply unsubscribe');
    expect(enrollment.contact.crmContactId).toBe('crm-ada');
  });
  it('cancels every created draft after a partial or ambiguous scheduler failure', async () => {
    const test = setup();
    vi.mocked(test.delivery.schedule)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('Request timed out'));
    await expect(test.engine.enroll(campaign, contact, start)).rejects.toThrow(
      'Request timed out'
    );
    expect(test.delivery.cancel).toHaveBeenCalledTimes(2);
    expect(test.snapshot().enrollments[0].status).toBe('needs_attention');
    expect(
      test
        .snapshot()
        .enrollments[0].steps.every((step) => step.status === 'canceled')
    ).toBe(true);
  });
  it('keeps failed cancellation visible and allows an explicit recovery stop', async () => {
    const test = setup();
    const enrollment = await test.engine.enroll(campaign, contact, start);
    vi.mocked(test.delivery.cancel).mockRejectedValueOnce(
      new Error('Gmail unavailable')
    );
    await expect(test.engine.stop(enrollment, 'stopped')).rejects.toThrow(
      'Gmail unavailable'
    );
    expect(test.snapshot().enrollments[0].status).toBe('needs_attention');
    await test.engine.stop(test.snapshot().enrollments[0], 'stopped');
    expect(test.snapshot().enrollments[0].status).toBe('stopped');
  });
  it('blocks duplicate contact emails across case variants, including stopped enrollments', async () => {
    const test = setup();
    const enrollment = await test.engine.enroll(campaign, contact, start);
    await test.engine.stop(enrollment, 'stopped');
    await expect(
      test.engine.enroll(
        campaign,
        { ...contact, email: 'ADA@example.com' },
        start
      )
    ).rejects.toThrow('already enrolled');
    expect(test.delivery.createDraft).toHaveBeenCalledTimes(2);
  });
  it('does not create any drafts if the reservation loses a database conflict', async () => {
    const test = setup();
    vi.mocked(test.repository.saveEnrollment).mockRejectedValueOnce(
      new Error('CONFLICT')
    );
    await expect(test.engine.enroll(campaign, contact, start)).rejects.toThrow(
      'CONFLICT'
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('rejects a stale active campaign after it was paused in another tab', async () => {
    const test = setup();
    await test.repository.saveCampaign({ ...campaign, status: 'paused' });
    await expect(test.engine.enroll(campaign, contact, start)).rejects.toThrow(
      'no longer active'
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('does not resume a stopped contact using an outdated paused record', async () => {
    const test = setup();
    const enrollment = await test.engine.enroll(campaign, contact, start);
    await test.engine.stop(enrollment, 'paused');
    const paused = structuredClone(test.snapshot().enrollments[0]);
    await test.engine.stop(paused, 'stopped');
    await expect(test.engine.resume(paused)).rejects.toThrow('Only paused');
    expect(test.delivery.createDraft).toHaveBeenCalledTimes(2);
  });
  it('rejects unsupported personalization and start times before any side effects', async () => {
    const test = setup();
    await expect(
      test.engine.enroll(
        {
          ...campaign,
          steps: [{ ...campaign.steps[0], subject: '{{company}}' }],
        },
        contact,
        start
      )
    ).rejects.toThrow('Unknown personalization');
    await expect(test.engine.enroll(campaign, contact, clock)).rejects.toThrow(
      'at least 10 minutes'
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('never lets a stale pause revive a stopped enrollment', async () => {
    const test = setup();
    const enrollment = await test.engine.enroll(campaign, contact, start);
    const stale = structuredClone(enrollment);
    await test.engine.stop(enrollment, 'stopped');
    await expect(test.engine.stop(stale, 'paused')).rejects.toThrow(
      'already stopped'
    );
    expect(test.snapshot().enrollments[0].status).toBe('stopped');
    // Repeating the same transition is a no-op, not a second cancellation.
    await test.engine.stop(stale, 'stopped');
    expect(test.delivery.cancel).toHaveBeenCalledTimes(2);
  });
  it('resumes steps a pause interrupted before they were drafted', async () => {
    const test = setup();
    vi.mocked(test.delivery.schedule)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('Paused in another tab'));
    await expect(
      test.engine.enroll(campaign, contact, start)
    ).rejects.toThrow();
    // Simulate the pause landing after the first step queued: the second step
    // has a draft that cancellation removed and the record is paused.
    const record = test.snapshot().enrollments[0];
    record.status = 'paused';
    record.steps[1] = {
      ...record.steps[1],
      draftId: undefined,
      status: 'pending',
    };
    const resumed = await test.engine.resume(record);
    expect(resumed.status).toBe('scheduled');
    // Both steps were never sent and are still ahead, so both are queued again
    // on their original times.
    expect(resumed.steps.map((step) => [step.status, step.sendAt])).toEqual([
      ['queued', '2026-10-03T16:00:00.000Z'],
      ['queued', '2026-10-05T16:00:00.000Z'],
    ]);
  });
  it('keeps the remaining cadence and never sends a resumed step early', async () => {
    let now = clock;
    const test = setup({ now: () => now });
    const queued = await test.engine.enroll(campaign, contact, start);
    await test.engine.stop(queued, 'paused');
    // A day later, step two (Oct 5 16:00) is still on time and keeps its slot;
    // step one is past due and is skipped, not sent late.
    now = new Date('2026-10-04T15:00:00Z');
    const onTime = await test.engine.resume(test.snapshot().enrollments[0]);
    expect(onTime.steps.map((step) => [step.status, step.sendAt])).toEqual([
      ['canceled', '2026-10-03T16:00:00.000Z'],
      ['queued', '2026-10-05T16:00:00.000Z'],
    ]);
  });
  it('shifts every remaining step together when the next one is too soon', async () => {
    let now = clock;
    const test = setup({ now: () => now });
    const queued = await test.engine.enroll(campaign, contact, start);
    await test.engine.stop(queued, 'paused');
    // Five minutes before step one: it moves to the earliest safe time and
    // step two keeps its two-day gap.
    now = new Date('2026-10-03T15:55:00Z');
    const resumed = await test.engine.resume(test.snapshot().enrollments[0]);
    expect(resumed.steps.map((step) => step.sendAt)).toEqual([
      '2026-10-03T16:06:00.000Z',
      '2026-10-05T16:06:00.000Z',
    ]);
  });
  it('lets a failed enrollment with nothing sent be retried in place', async () => {
    const test = setup();
    vi.mocked(test.delivery.schedule).mockRejectedValueOnce(
      new Error('Gmail unavailable')
    );
    await expect(test.engine.enroll(campaign, contact, start)).rejects.toThrow(
      'Gmail unavailable'
    );
    expect(test.snapshot().enrollments[0].status).toBe('needs_attention');
    const retried = await test.engine.enroll(campaign, contact, start);
    expect(retried.id).toBe('enrollment');
    expect(retried.status).toBe('scheduled');
    expect(test.snapshot().enrollments).toHaveLength(1);
  });
  it('still blocks re-enrolling a contact with a queued or paused enrollment', async () => {
    const test = setup();
    const enrollment = await test.engine.enroll(campaign, contact, start);
    await test.engine.stop(enrollment, 'paused');
    await expect(test.engine.enroll(campaign, contact, start)).rejects.toThrow(
      'already enrolled'
    );
  });
  it('enrolls a batch with one load and reports each failure by contact', async () => {
    const test = setup();
    const { enrolled, failures } = await test.engine.enrollMany(
      campaign,
      [
        contact,
        { name: 'Ada again', email: 'ADA@example.com' },
        { name: 'Grace', email: 'grace@example.com' },
      ],
      start
    );
    expect(enrolled.map((entry) => entry.contact.email)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
    expect(failures).toEqual([
      {
        email: 'ADA@example.com',
        message: 'ada@example.com is already enrolled in this campaign.',
      },
    ]);
    // One load up front, one after the duplicate failure.
    expect(test.repository.load).toHaveBeenCalledTimes(2);
  });
  it('refuses to send from an inbox that is not connected to this account', async () => {
    const test = setup({ senderStatus: () => 'disconnected' });
    await expect(test.engine.enroll(campaign, contact, start)).rejects.toThrow(
      'no longer connected'
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('stops a disconnected inbox enrollment without calling the scheduler', async () => {
    let status: SenderStatus = 'ready';
    const test = setup({ senderStatus: () => status });
    const enrollment = await test.engine.enroll(campaign, contact, start);
    status = 'disconnected';
    await test.engine.stop(enrollment, 'stopped');
    const saved = test.snapshot().enrollments[0];
    expect(saved.status).toBe('stopped');
    expect(saved.steps.every((step) => step.status === 'canceled')).toBe(true);
    expect(saved.error).toContain('disconnected');
    expect(test.delivery.cancel).not.toHaveBeenCalled();
  });
  it('does not cancel anything while inboxes are still loading', async () => {
    let status: SenderStatus | undefined = 'ready';
    const test = setup({ senderStatus: () => status });
    const enrollment = await test.engine.enroll(campaign, contact, start);
    status = undefined;
    await expect(test.engine.stop(enrollment, 'stopped')).rejects.toThrow(
      'still loading'
    );
    expect(test.delivery.cancel).not.toHaveBeenCalled();
    expect(test.snapshot().enrollments[0].status).toBe('scheduled');
  });
});
