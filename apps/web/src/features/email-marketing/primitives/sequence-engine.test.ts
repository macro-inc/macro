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
function setup() {
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
    createDraft: vi.fn(async () => `draft-${++draft}`),
    schedule: vi.fn(async () => {}),
    cancel: vi.fn(async () => 'canceled' as const),
  };
  const engine = createSequenceEngine(
    repository,
    delivery,
    () => clock,
    () => 'enrollment'
  );
  return { repository, delivery, engine, saved, snapshot: () => snapshot };
}
const start = new Date('2026-10-03T16:00:00Z');

describe('server scheduled sequences', () => {
  it('reserves before sending, persists every handle before scheduling, and freezes personalized content', async () => {
    const test = setup();
    vi.mocked(test.delivery.schedule).mockImplementation(async (_, draftId) => {
      expect(
        test.saved
          .at(-1)
          ?.steps.some(
            (step) => step.draftId === draftId && step.status === 'scheduling'
          )
      ).toBe(true);
    });
    const enrollment = await test.engine.enroll(campaign, contact, start);
    expect(test.saved[0].status).toBe('preparing');
    expect(enrollment.status).toBe('scheduled');
    expect(test.delivery.schedule).toHaveBeenNthCalledWith(
      1,
      'gmail',
      'draft-1',
      '2026-10-03T16:00:00.000Z'
    );
    expect(test.delivery.schedule).toHaveBeenNthCalledWith(
      2,
      'gmail',
      'draft-2',
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
});
