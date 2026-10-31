import { describe, expect, it, vi } from 'vitest';
import type {
  MarketingRepository,
  SequenceDelivery,
} from '../context/contracts';
import { MarketingError } from '../core/errors';
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
const threaded: Campaign = {
  ...campaign,
  steps: [
    campaign.steps[0],
    { ...campaign.steps[1], subject: '', asReply: true },
    { id: 'third', delayDays: 1, subject: '', body: 'Last one', asReply: true },
  ],
};
const contact: MarketingContact = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  crmContactId: 'crm-ada',
};
const conflict = () => new MarketingError('changedElsewhere');

function setup(
  options: {
    now?: () => Date;
    senderStatus?: (id: string) => SenderStatus | undefined;
    campaigns?: Campaign[];
  } = {}
) {
  let ids = 0;
  let snapshot: MarketingSnapshot = {
    campaigns: structuredClone(options.campaigns ?? [campaign]),
    enrollments: [],
    unsubscribed: [],
    unreadable: 0,
    writable: true,
  };
  const saved: Enrollment[] = [];
  const repository: MarketingRepository = {
    load: vi.fn(async () => structuredClone(snapshot)),
    saveCampaign: vi.fn(async (value) => {
      snapshot.campaigns = [
        ...snapshot.campaigns.filter((item) => item.id !== value.id),
        structuredClone(value),
      ];
    }),
    saveEnrollment: vi.fn(async (entry) => {
      saved.push(structuredClone(entry));
      snapshot.enrollments = [
        ...snapshot.enrollments.filter((value) => value.id !== entry.id),
        structuredClone(entry),
      ];
    }),
    deleteCampaign: vi.fn(async (campaignId, enrollmentIds) => {
      snapshot.campaigns = snapshot.campaigns.filter(
        (item) => item.id !== campaignId
      );
      snapshot.enrollments = snapshot.enrollments.filter(
        (entry) => !enrollmentIds.includes(entry.id)
      );
    }),
    saveUnsubscribe: vi.fn(async (entry) => {
      snapshot.unsubscribed = [
        ...snapshot.unsubscribed,
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
    scheduled: vi.fn(async (): Promise<Set<string> | undefined> => undefined),
    inspect: vi.fn(async () => ({ issues: {}, untracked: [], sent: [] })),
  };
  const engine = createSequenceEngine(repository, delivery, {
    now: options.now ?? (() => clock),
    id: () => (ids++ ? `enrollment-${ids}` : 'enrollment'),
    senderStatus: options.senderStatus,
  });
  /** Enroll one contact, throwing its failure. */
  async function enroll(
    target: Campaign,
    person: MarketingContact,
    startAt: Date
  ) {
    const { enrolled, failures } = await engine.enrollMany(
      target,
      [person],
      startAt
    );
    if (failures.length) throw failures[0].error;
    return enrolled[0];
  }
  return {
    repository,
    delivery,
    engine,
    enroll,
    saved,
    snapshot: () => snapshot,
    edit: (change: (data: MarketingSnapshot) => void) => {
      snapshot = structuredClone(snapshot);
      change(snapshot);
    },
  };
}
const start = new Date('2026-10-03T16:00:00Z');
const code = (value: string) => expect.objectContaining({ code: value });

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
    const enrollment = await test.enroll(campaign, contact, start);
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
    expect(enrollment.steps[0].body).toContain('reply "unsubscribe"');
    expect(enrollment.contact.crmContactId).toBe('crm-ada');
    // Separate emails: neither replies to the other.
    expect(
      vi
        .mocked(test.delivery.createDraft)
        .mock.calls.map(([, content]) => content.replyingToId)
    ).toEqual([undefined, undefined]);
  });
  it('sends follow-ups as replies to the previous email, after it is scheduled', async () => {
    const test = setup({ campaigns: [threaded] });
    const order: string[] = [];
    vi.mocked(test.delivery.createDraft).mockImplementation(
      async (_, content) => {
        order.push(`create:${content.replyingToId ?? 'none'}`);
        const id = `draft-${order.length}`;
        return { id, generation: 0, threadId: 'thread-1' };
      }
    );
    vi.mocked(test.delivery.schedule).mockImplementation(async (_, draft) => {
      order.push(`schedule:${draft.draftId}`);
    });
    const enrollment = await test.enroll(threaded, contact, start);
    expect(order).toEqual([
      'create:none',
      'schedule:draft-1',
      'create:draft-1',
      'schedule:draft-3',
      'create:draft-3',
      'schedule:draft-5',
    ]);
    expect(
      vi
        .mocked(test.delivery.createDraft)
        .mock.calls.map(([, content]) => content.subject)
    ).toEqual(['Hi Ada', 'Re: Hi Ada', 'Re: Hi Ada']);
    expect(enrollment.steps.map((step) => step.subject)).toEqual([
      'Hi Ada',
      'Re: Hi Ada',
      'Re: Hi Ada',
    ]);
  });
  it("starts a new thread when the email that began a reply's thread was skipped", async () => {
    // Welcome starts one thread; Case study starts another that Last call answers.
    const branches: Campaign = {
      ...campaign,
      steps: [
        campaign.steps[0],
        { id: 'case', delayDays: 2, subject: 'Case study', body: 'Read it' },
        {
          id: 'last',
          delayDays: 2,
          subject: '',
          body: 'Last call',
          asReply: true,
        },
      ],
    };
    let now = clock;
    const test = setup({ campaigns: [branches], now: () => now });
    const queued = await test.enroll(branches, contact, start);
    // Welcome went out before the pause; Case study is past due on resume.
    now = new Date('2026-10-03T17:00:00Z');
    vi.mocked(test.delivery.cancel).mockImplementation(async (_, draft) =>
      draft.draftId === 'draft-1' ? 'delivery_started' : 'canceled'
    );
    await test.engine.stop(queued, 'paused');
    now = new Date('2026-10-06T15:00:00Z');
    vi.mocked(test.delivery.createDraft).mockClear();
    const resumed = await test.engine.resume(test.snapshot().enrollments[0]);
    expect(resumed.steps.map((step) => step.status)).toEqual([
      'delivery_started',
      'canceled',
      'queued',
    ]);
    // Not a reply to Welcome: that is another thread, under another subject.
    expect(vi.mocked(test.delivery.createDraft).mock.calls).toEqual([
      [
        'gmail',
        expect.objectContaining({
          subject: 'Case study',
          replyingToId: undefined,
        }),
      ],
    ]);
  });

  it('starts over when a paused contact never received anything', async () => {
    let now = clock;
    const test = setup({ campaigns: [threaded], now: () => now });
    vi.mocked(test.delivery.schedule).mockRejectedValueOnce(new Error('503'));
    await expect(test.enroll(threaded, contact, start)).rejects.toThrow('503');
    // Pausing a failed enrollment clears its error; its times then pass.
    await test.engine.stop(test.snapshot().enrollments[0], 'paused');
    now = new Date('2026-10-08T15:00:00Z');
    const resumed = await test.engine.resume(test.snapshot().enrollments[0]);
    expect(resumed.steps.map((step) => [step.status, step.sendAt])).toEqual([
      ['queued', '2026-10-08T15:11:00.000Z'],
      ['queued', '2026-10-10T15:11:00.000Z'],
      ['queued', '2026-10-11T15:11:00.000Z'],
    ]);
    expect(resumed.steps[1].subject).toBe('Re: Hi Ada');
  });
  it('cancels every created draft after a partial or ambiguous scheduler failure', async () => {
    const test = setup();
    vi.mocked(test.delivery.schedule)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('Request timed out'));
    await expect(test.enroll(campaign, contact, start)).rejects.toThrow(
      'Request timed out'
    );
    expect(test.delivery.cancel).toHaveBeenCalledTimes(2);
    const stored = test.snapshot().enrollments[0];
    expect(stored.status).toBe('needs_attention');
    expect(stored.error).toBe('scheduleFailed');
    expect(stored.steps.every((step) => step.status === 'canceled')).toBe(true);
  });
  it('cancels the last step first, so no reply outlives the email it answers', async () => {
    const test = setup({ campaigns: [threaded] });
    const enrollment = await test.enroll(threaded, contact, start);
    await test.engine.stop(enrollment, 'stopped');
    expect(
      vi
        .mocked(test.delivery.cancel)
        .mock.calls.map(([, draft]) => draft.draftId)
    ).toEqual(['draft-3', 'draft-2', 'draft-1']);
  });
  it('keeps failed cancellation visible and allows an explicit recovery stop', async () => {
    const test = setup();
    const enrollment = await test.enroll(campaign, contact, start);
    vi.mocked(test.delivery.cancel).mockRejectedValueOnce(
      new Error('Gmail unavailable')
    );
    await expect(test.engine.stop(enrollment, 'stopped')).rejects.toEqual(
      code('cancelFailed')
    );
    expect(test.snapshot().enrollments[0]).toMatchObject({
      status: 'needs_attention',
      error: 'cancelFailed',
    });
    await test.engine.stop(test.snapshot().enrollments[0], 'stopped');
    expect(test.snapshot().enrollments[0].status).toBe('stopped');
  });
  it('blocks duplicate contact emails across case variants, including stopped enrollments', async () => {
    const test = setup();
    const enrollment = await test.enroll(campaign, contact, start);
    await test.engine.stop(enrollment, 'stopped');
    await expect(
      test.enroll(campaign, { ...contact, email: 'ADA@example.com' }, start)
    ).rejects.toEqual(code('alreadyEnrolled'));
    expect(test.delivery.createDraft).toHaveBeenCalledTimes(2);
  });
  it('does not create any drafts if the reservation loses to another enrollment of the address', async () => {
    const test = setup();
    vi.mocked(test.repository.saveEnrollment).mockImplementationOnce(
      async () => {
        // Another tab reserved the same address first.
        test.edit((data) => {
          data.enrollments.push({
            id: 'other-tab',
            campaignId: campaign.id,
            campaignName: campaign.name,
            contact,
            senderId: 'gmail',
            status: 'preparing',
            steps: [],
            createdAt: clock.toISOString(),
            updatedAt: clock.toISOString(),
          });
        });
        throw conflict();
      }
    );
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('changedElsewhere')
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('retries a write that lost to an unrelated change and keeps scheduling', async () => {
    const test = setup();
    let failed = false;
    vi.mocked(test.repository.saveEnrollment).mockImplementation(
      async (entry) => {
        if (
          !failed &&
          entry.steps.some((step) => step.status === 'scheduling')
        ) {
          failed = true;
          throw conflict();
        }
        test.edit((data) => {
          data.enrollments = [
            ...data.enrollments.filter((value) => value.id !== entry.id),
            structuredClone(entry),
          ];
        });
      }
    );
    const enrollment = await test.enroll(campaign, contact, start);
    expect(enrollment.status).toBe('scheduled');
    expect(test.delivery.cancel).not.toHaveBeenCalled();
  });
  it('cancels instead of retrying when the campaign was paused mid-enrollment', async () => {
    const test = setup();
    let failed = false;
    vi.mocked(test.repository.saveEnrollment).mockImplementation(
      async (entry) => {
        if (
          !failed &&
          entry.steps.some((step) => step.status === 'scheduling')
        ) {
          failed = true;
          test.edit((data) => {
            data.campaigns[0].status = 'paused';
          });
          throw conflict();
        }
        test.edit((data) => {
          data.enrollments = [
            ...data.enrollments.filter((value) => value.id !== entry.id),
            structuredClone(entry),
          ];
        });
      }
    );
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('changedElsewhere')
    );
    expect(test.delivery.schedule).not.toHaveBeenCalled();
    expect(test.delivery.cancel).toHaveBeenCalledTimes(1);
    expect(test.snapshot().enrollments[0].status).toBe('needs_attention');
  });
  it('rejects a stale active campaign after it was paused in another tab', async () => {
    const test = setup();
    await test.repository.saveCampaign({ ...campaign, status: 'paused' });
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('campaignInactive')
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('refuses to enroll while some records cannot be read', async () => {
    const test = setup();
    test.edit((data) => {
      data.unreadable = 1;
    });
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('unreadableRecords')
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('does not resume a stopped contact using an outdated paused record', async () => {
    const test = setup();
    const enrollment = await test.enroll(campaign, contact, start);
    await test.engine.stop(enrollment, 'paused');
    const paused = structuredClone(test.snapshot().enrollments[0]);
    await test.engine.stop(paused, 'stopped');
    await expect(test.engine.resume(paused)).rejects.toEqual(code('notPaused'));
    expect(test.delivery.createDraft).toHaveBeenCalledTimes(2);
  });
  it('rejects unsupported personalization and start times before any side effects', async () => {
    const test = setup();
    await expect(
      test.enroll(
        {
          ...campaign,
          steps: [{ ...campaign.steps[0], subject: '{{company}}' }],
        },
        contact,
        start
      )
    ).rejects.toEqual(code('unknownPersonalization'));
    await expect(test.enroll(campaign, contact, clock)).rejects.toEqual(
      code('startTooSoon')
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('never lets a stale pause revive a stopped enrollment', async () => {
    const test = setup();
    const enrollment = await test.enroll(campaign, contact, start);
    const stale = structuredClone(enrollment);
    await test.engine.stop(enrollment, 'stopped');
    await expect(test.engine.stop(stale, 'paused')).rejects.toEqual(
      code('enrollmentStopped')
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
    await expect(test.enroll(campaign, contact, start)).rejects.toThrow();
    // Simulate the pause landing after the first step queued: the second step
    // has a draft that cancellation removed and the record is paused.
    const record = test.snapshot().enrollments[0];
    test.edit((data) => {
      data.enrollments[0].status = 'paused';
      data.enrollments[0].steps[1] = {
        ...record.steps[1],
        draftId: undefined,
        status: 'pending',
      };
    });
    const resumed = await test.engine.resume(test.snapshot().enrollments[0]);
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
    const queued = await test.enroll(campaign, contact, start);
    now = new Date('2026-10-03T17:00:00Z');
    vi.mocked(test.delivery.cancel).mockImplementation(async (_, draft) =>
      draft.draftId === 'draft-1' ? 'delivery_started' : 'canceled'
    );
    await test.engine.stop(queued, 'paused');
    // A day later, step two (Oct 5 16:00) is still on time and keeps its slot.
    now = new Date('2026-10-04T15:00:00Z');
    const onTime = await test.engine.resume(test.snapshot().enrollments[0]);
    expect(onTime.steps.map((step) => [step.status, step.sendAt])).toEqual([
      ['delivery_started', '2026-10-03T16:00:00.000Z'],
      ['queued', '2026-10-05T16:00:00.000Z'],
    ]);
  });
  it('shifts every remaining step together when the next one is too soon', async () => {
    let now = clock;
    const test = setup({ now: () => now });
    const queued = await test.enroll(campaign, contact, start);
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
    await expect(test.enroll(campaign, contact, start)).rejects.toThrow(
      'Gmail unavailable'
    );
    expect(test.snapshot().enrollments[0].status).toBe('needs_attention');
    const retried = await test.enroll(campaign, contact, start);
    expect(retried.id).toBe('enrollment');
    expect(retried.status).toBe('scheduled');
    expect(test.snapshot().enrollments).toHaveLength(1);
  });
  it('still blocks re-enrolling a contact with a queued or paused enrollment', async () => {
    const test = setup();
    const enrollment = await test.enroll(campaign, contact, start);
    await test.engine.stop(enrollment, 'paused');
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('alreadyEnrolled')
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
        error: code('alreadyEnrolled'),
      },
    ]);
    // One load up front; a failure that isn't a conflict needs no reload.
    expect(test.repository.load).toHaveBeenCalledTimes(1);
  });
  it('refuses to send from an inbox that is not connected to this account', async () => {
    const test = setup({ senderStatus: () => 'disconnected' });
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('inboxDisconnected')
    );
    expect(test.delivery.createDraft).not.toHaveBeenCalled();
  });
  it('cancels on the server even when the inbox is missing from the loaded list', async () => {
    // The list may be stale (an inbox connected in another tab); a deleted
    // inbox's drafts answer not found, which the delivery reports as canceled.
    let status: SenderStatus = 'ready';
    const test = setup({ senderStatus: () => status });
    const enrollment = await test.enroll(campaign, contact, start);
    status = 'disconnected';
    await test.engine.stop(enrollment, 'stopped');
    const saved = test.snapshot().enrollments[0];
    expect(saved.status).toBe('stopped');
    expect(saved.steps.every((step) => step.status === 'canceled')).toBe(true);
    expect(saved.error).toBeUndefined();
    expect(
      vi.mocked(test.delivery.cancel).mock.calls.map(([, d]) => d.draftId)
    ).toEqual(['draft-2', 'draft-1']);
  });

  it('keeps an earlier step when canceling a later one fails, so no reply goes out unthreaded', async () => {
    const test = setup({ campaigns: [threaded] });
    const enrollment = await test.enroll(threaded, contact, start);
    vi.mocked(test.delivery.cancel).mockImplementation(async (_, draft) => {
      if (draft.draftId === 'draft-2') throw new Error('503');
      return 'canceled';
    });
    await expect(test.engine.stop(enrollment, 'paused')).rejects.toThrow(
      code('cancelFailed')
    );
    const saved = test.snapshot().enrollments[0];
    expect(saved.steps.map((step) => step.status)).toEqual([
      'queued',
      'queued',
      'canceled',
    ]);
    expect(saved).toMatchObject({
      status: 'needs_attention',
      error: 'cancelFailed',
    });
    expect(
      vi.mocked(test.delivery.cancel).mock.calls.map(([, d]) => d.draftId)
    ).toEqual(['draft-3', 'draft-2']);
  });

  it('marks steps the scheduler already sent without canceling them, and leaves a finished enrollment as it is', async () => {
    let now = clock;
    const test = setup({ now: () => now });
    await test.enroll(campaign, contact, start);
    now = new Date('2026-10-06T15:00:00Z');
    vi.mocked(test.delivery.scheduled).mockResolvedValue(new Set());
    await test.engine.pauseCampaign(campaign);
    const saved = test.snapshot().enrollments[0];
    expect(saved.status).toBe('scheduled');
    expect(saved.steps.map((step) => step.status)).toEqual([
      'delivery_started',
      'delivery_started',
    ]);
    expect(test.delivery.cancel).not.toHaveBeenCalled();
    // One scheduler read for the whole action, and nothing left to write next time.
    expect(test.delivery.scheduled).toHaveBeenCalledTimes(1);
    const writes = test.saved.length;
    await test.engine.pauseCampaign(campaign);
    expect(test.saved).toHaveLength(writes);
  });

  it('cancels only the steps the scheduler still holds once some were sent', async () => {
    let now = clock;
    const test = setup({ now: () => now });
    const enrollment = await test.enroll(campaign, contact, start);
    now = new Date('2026-10-04T15:00:00Z');
    vi.mocked(test.delivery.scheduled).mockResolvedValue(new Set(['draft-2']));
    await test.engine.stop(enrollment, 'paused');
    const saved = test.snapshot().enrollments[0];
    expect(saved.status).toBe('paused');
    expect(saved.steps.map((step) => step.status)).toEqual([
      'delivery_started',
      'canceled',
    ]);
    expect(
      vi.mocked(test.delivery.cancel).mock.calls.map(([, d]) => d.draftId)
    ).toEqual(['draft-2']);
  });

  it('asks the server step by step when the scheduler list cannot be read', async () => {
    let now = clock;
    const test = setup({ now: () => now });
    const enrollment = await test.enroll(campaign, contact, start);
    now = new Date('2026-10-04T15:00:00Z');
    vi.mocked(test.delivery.scheduled).mockRejectedValue(new Error('503'));
    await test.engine.stop(enrollment, 'paused');
    expect(test.delivery.cancel).toHaveBeenCalledTimes(2);
  });

  it('refuses to stop orphans or cancel untracked emails while a record is unreadable', async () => {
    const test = setup();
    const enrollment = await test.enroll(campaign, contact, start);
    test.edit((data) => {
      data.campaigns = [];
      data.unreadable = 1;
    });
    await expect(test.engine.stopOrphans()).rejects.toThrow(
      code('unreadableRecords')
    );
    await expect(
      test.engine.cancelUntracked('gmail', ['stray'])
    ).rejects.toThrow(code('unreadableRecords'));
    expect(test.delivery.cancel).not.toHaveBeenCalled();
    expect(test.snapshot().enrollments[0]).toEqual(enrollment);
  });

  it('treats steps already handed to Gmail as tracked, and reports a stray email it cannot recall', async () => {
    const test = setup();
    await test.enroll(campaign, contact, start);
    test.edit((data) => {
      data.enrollments[0].steps[0].status = 'delivery_started';
    });
    vi.mocked(test.delivery.cancel).mockResolvedValue('delivery_started');
    await expect(
      test.engine.cancelUntracked('gmail', ['draft-1', 'stray'])
    ).rejects.toThrow(code('cancelFailed'));
    expect(
      vi.mocked(test.delivery.cancel).mock.calls.map(([, d]) => d.draftId)
    ).toEqual(['stray']);
  });
  it('does not cancel anything while inboxes are still loading', async () => {
    let status: SenderStatus | undefined = 'ready';
    const test = setup({ senderStatus: () => status });
    const enrollment = await test.enroll(campaign, contact, start);
    status = undefined;
    await expect(test.engine.stop(enrollment, 'stopped')).rejects.toEqual(
      code('inboxesLoading')
    );
    expect(test.delivery.cancel).not.toHaveBeenCalled();
    expect(test.snapshot().enrollments[0].status).toBe('scheduled');
  });
});

describe('unsubscribe', () => {
  const other: Campaign = { ...campaign, id: 'other', name: 'Other' };
  it('stops the address in every campaign and blocks enrolling it again', async () => {
    const test = setup({ campaigns: [campaign, other] });
    await test.enroll(campaign, contact, start);
    await test.enroll(other, contact, start);
    await test.engine.unsubscribe('ADA@example.com');
    expect(test.snapshot().unsubscribed).toEqual([
      { email: 'ada@example.com', unsubscribedAt: clock.toISOString() },
    ]);
    expect(test.snapshot().enrollments.map((entry) => entry.status)).toEqual([
      'stopped',
      'stopped',
    ]);
    expect(test.delivery.cancel).toHaveBeenCalledTimes(4);
    const fresh: Campaign = { ...campaign, id: 'fresh' };
    await test.repository.saveCampaign(fresh);
    await expect(test.enroll(fresh, contact, start)).rejects.toEqual(
      code('unsubscribed')
    );
  });
  it('is idempotent and also blocks resuming a paused enrollment', async () => {
    const test = setup();
    const enrollment = await test.enroll(campaign, contact, start);
    await test.engine.stop(enrollment, 'paused');
    test.edit((data) => {
      data.unsubscribed.push({
        email: 'ada@example.com',
        unsubscribedAt: clock.toISOString(),
      });
    });
    await expect(
      test.engine.resume(test.snapshot().enrollments[0])
    ).rejects.toEqual(code('unsubscribed'));
    await test.engine.unsubscribe('ada@example.com');
    expect(test.repository.saveUnsubscribe).not.toHaveBeenCalled();
    expect(test.snapshot().enrollments[0].status).toBe('stopped');
  });
});

describe('delete campaign', () => {
  it('pauses, stops every enrollment, then removes the campaign and its records', async () => {
    const test = setup();
    await test.enroll(campaign, contact, start);
    await test.enroll(
      campaign,
      { name: 'Grace', email: 'g@example.com' },
      start
    );
    await test.engine.deleteCampaign(campaign);
    expect(test.delivery.cancel).toHaveBeenCalledTimes(4);
    expect(test.repository.deleteCampaign).toHaveBeenCalledWith('welcome', [
      'enrollment',
      'enrollment-2',
    ]);
    expect(test.snapshot().campaigns).toEqual([]);
    expect(test.snapshot().enrollments).toEqual([]);
  });
  it('keeps the campaign when an upcoming email cannot be canceled', async () => {
    const test = setup();
    await test.enroll(campaign, contact, start);
    vi.mocked(test.delivery.cancel).mockRejectedValueOnce(
      new Error('Gmail unavailable')
    );
    await expect(test.engine.deleteCampaign(campaign)).rejects.toEqual(
      code('contactsFailed')
    );
    expect(test.repository.deleteCampaign).not.toHaveBeenCalled();
    expect(test.snapshot().campaigns).toHaveLength(1);
  });
});

describe('concurrent changes', () => {
  const grace: MarketingContact = { name: 'Grace', email: 'grace@example.com' };
  /** Fail the first write that matches with a conflict, after changing storage. */
  function conflictOnce(
    test: ReturnType<typeof setup>,
    when: (entry: Enrollment) => boolean,
    change: (data: MarketingSnapshot) => void
  ) {
    let done = false;
    vi.mocked(test.repository.saveEnrollment).mockImplementation(
      async (entry) => {
        if (!done && when(entry)) {
          done = true;
          test.edit(change);
          throw conflict();
        }
        test.edit((data) => {
          data.enrollments = [
            ...data.enrollments.filter((value) => value.id !== entry.id),
            structuredClone(entry),
          ];
        });
      }
    );
  }
  const unsubscribe = (email: string) => (data: MarketingSnapshot) => {
    data.unsubscribed.push({ email, unsubscribedAt: clock.toISOString() });
  };
  const drafting = (email: string) => (entry: Enrollment) =>
    entry.contact.email === email &&
    entry.steps.some((step) => step.status === 'scheduling');

  it('a running batch sees an unsubscribe made in another tab', async () => {
    const test = setup();
    conflictOnce(
      test,
      drafting('grace@example.com'),
      unsubscribe('ada@example.com')
    );
    const { enrolled, failures } = await test.engine.enrollMany(
      campaign,
      [grace, contact],
      start
    );
    expect(enrolled.map((entry) => entry.contact.email)).toEqual([
      'grace@example.com',
    ]);
    expect(failures).toEqual([
      { email: contact.email, error: code('unsubscribed') },
    ]);
    expect(
      vi
        .mocked(test.delivery.createDraft)
        .mock.calls.some(([, content]) => content.email === contact.email)
    ).toBe(false);
  });
  it('stops scheduling a contact who unsubscribed mid-enrollment', async () => {
    const test = setup();
    conflictOnce(test, drafting(contact.email), unsubscribe(contact.email));
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('changedElsewhere')
    );
    expect(test.delivery.schedule).not.toHaveBeenCalled();
    expect(test.delivery.cancel).toHaveBeenCalledTimes(1);
  });
  it('leaves a stop made in another tab in place instead of overwriting it', async () => {
    const test = setup();
    conflictOnce(test, drafting(contact.email), (data) => {
      data.enrollments[0] = { ...data.enrollments[0], status: 'stopped' };
    });
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('changedElsewhere')
    );
    expect(test.snapshot().enrollments[0].status).toBe('stopped');
    expect(test.delivery.cancel).toHaveBeenCalledTimes(1);
  });
  it('does not mark an enrollment scheduled after its campaign was paused', async () => {
    const test = setup();
    conflictOnce(
      test,
      (entry) => entry.status === 'scheduled',
      (data) => {
        data.campaigns[0].status = 'paused';
      }
    );
    await expect(test.enroll(campaign, contact, start)).rejects.toEqual(
      code('changedElsewhere')
    );
    const stored = test.snapshot().enrollments[0];
    expect(stored.status).toBe('needs_attention');
    expect(stored.steps.every((step) => step.status === 'canceled')).toBe(true);
  });
  it('keeps stopping while another tab’s batch keeps changing the tables', async () => {
    const test = setup();
    const enrollment = await test.enroll(campaign, contact, start);
    let conflicts = 3;
    vi.mocked(test.repository.saveEnrollment).mockImplementation(
      async (entry) => {
        if (conflicts-- > 0) throw conflict();
        test.edit((data) => {
          data.enrollments = [structuredClone(entry)];
        });
      }
    );
    await test.engine.stop(enrollment, 'stopped');
    expect(test.snapshot().enrollments[0].status).toBe('stopped');
  });
  it('starts later contacts later instead of running into the safety window', async () => {
    let now = clock;
    const test = setup({ now: () => now });
    const tight = new Date(clock.getTime() + 10 * 60_000);
    vi.mocked(test.delivery.createDraft).mockImplementation(async () => {
      // Every draft takes a minute, so the batch outlasts the start time.
      now = new Date(now.getTime() + 60_000);
      return { id: crypto.randomUUID(), generation: 0, threadId: 't' };
    });
    const { enrolled, failures } = await test.engine.enrollMany(
      campaign,
      [contact, grace],
      tight
    );
    expect(failures).toEqual([]);
    expect(new Date(enrolled[1].steps[0].sendAt).getTime()).toBeGreaterThan(
      tight.getTime()
    );
  });
  it('refuses to delete a campaign while some records cannot be read', async () => {
    const test = setup();
    test.edit((data) => {
      data.unreadable = 1;
    });
    await expect(test.engine.deleteCampaign(campaign)).rejects.toEqual(
      code('unreadableRecords')
    );
    expect(test.repository.deleteCampaign).not.toHaveBeenCalled();
  });
  it('stops enrollments whose campaign record was deleted elsewhere', async () => {
    const test = setup();
    await test.enroll(campaign, contact, start);
    test.edit((data) => {
      data.campaigns = [];
    });
    await test.engine.stopOrphans();
    expect(test.snapshot().enrollments[0].status).toBe('stopped');
    expect(test.delivery.cancel).toHaveBeenCalledTimes(2);
  });
  it('cancels only scheduled emails that no record knows about', async () => {
    const test = setup();
    await test.enroll(campaign, contact, start);
    await test.engine.cancelUntracked('gmail', ['draft-1', 'orphan']);
    expect(
      vi
        .mocked(test.delivery.cancel)
        .mock.calls.map(([, draft]) => draft.draftId)
    ).toEqual(['orphan']);
  });
});
