import { deepEqual } from '@core/util/compareUtils';
import { match } from 'ts-pattern';
import type {
  MarketingRepository,
  SequenceDelivery,
} from '../context/contracts';
import { type ContactFailure, MarketingError } from '../core/errors';
import {
  type Campaign,
  contactSchema,
  type Enrollment,
  isReplaceable,
  isUnsubscribed,
  type MarketingContact,
  type MarketingSnapshot,
  MIN_START_DELAY_MS,
  normalizeEmail,
  planSteps,
  replyParent,
  rescheduleSteps,
  type SenderStatus,
  standaloneSubject,
  validateCampaign,
} from '../core/model';

export type EngineOptions = {
  now?: () => Date;
  id?: () => string;
  /**
   * The signed-in user's view of an inbox; `undefined` while inboxes are
   * still loading. Omit to trust every sender (tests and fixtures).
   */
  senderStatus?: (senderId: string) => SenderStatus | undefined;
};

/** Statuses a stop may move from, per requested target. */
const STOPPABLE: Record<'paused' | 'stopped', Enrollment['status'][]> = {
  paused: ['preparing', 'scheduled', 'needs_attention'],
  stopped: ['preparing', 'scheduled', 'needs_attention', 'paused'],
};

/**
 * Writes that lose to unrelated changes elsewhere (another tab enrolling,
 * an edit in the database view) try this many times in all.
 */
const MAX_WRITE_ATTEMPTS = 5;

/** Failures that end a batch: every remaining contact would fail the same way. */
const BATCH_STOPPERS = [
  'campaignInactive',
  'campaignChanged',
  'unreadableRecords',
] as const;

function isConflict(error: unknown) {
  return error instanceof MarketingError && error.code === 'changedElsewhere';
}

type Guard = (current: MarketingSnapshot) => boolean;
type Match = (entry: Enrollment, current: MarketingSnapshot) => boolean;

/** Uses the existing server scheduler. No timers, sending secrets, or browser-open requirement. */
export function createSequenceEngine(
  repository: MarketingRepository,
  delivery: SequenceDelivery,
  options: EngineOptions = {}
) {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? (() => crypto.randomUUID());
  const senderStatus = (senderId: string) =>
    options.senderStatus ? options.senderStatus(senderId) : 'ready';

  /**
   * The newest load. The repository's table versions always match it, so a
   * check against it and the write that follows race nothing in between:
   * any later change elsewhere makes that write conflict.
   */
  let latest: MarketingSnapshot | undefined;
  async function load() {
    latest = await repository.load();
    return latest;
  }
  /** Keep the newest load current with this engine's own writes. */
  function remember(enrollment: Enrollment) {
    if (!latest) return;
    latest = {
      ...latest,
      enrollments: [
        ...latest.enrollments.filter((entry) => entry.id !== enrollment.id),
        enrollment,
      ],
    };
  }

  function requireReadySender(senderId: string) {
    match(senderStatus(senderId))
      .with('ready', () => {})
      .with('disconnected', () => {
        throw new MarketingError('inboxDisconnected');
      })
      .with('reauth', () => {
        throw new MarketingError('inboxReauth');
      })
      .with(undefined, () => {
        throw new MarketingError('inboxesLoading');
      })
      .exhaustive();
  }

  /**
   * Writes for one enrollment. Each carries every table version; after a
   * conflict it reloads and retries while the record is exactly as this
   * writer last saw it and `guard` still holds.
   */
  function recordWriter(
    enrollment: Enrollment,
    stored: Enrollment | undefined,
    guard: Guard
  ) {
    let last = stored && structuredClone(stored);
    const owns: Guard = (current) =>
      deepEqual(
        current.enrollments.find((entry) => entry.id === enrollment.id),
        last
      );
    async function save(check: Guard) {
      enrollment.updatedAt = now().toISOString();
      const value = structuredClone(enrollment);
      for (let attempt = 1; ; attempt++) {
        try {
          await repository.saveEnrollment(value);
          break;
        } catch (error) {
          if (!isConflict(error) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
          if (!check(await load())) throw error;
        }
      }
      last = value;
      remember(value);
    }
    return {
      /** A step forward; refused once anything it depends on changed. */
      write: () => save((current) => owns(current) && guard(current)),
      /** Record a failure, unless someone else has changed the record since. */
      async settle() {
        if (owns(await load())) await save(owns);
      },
    };
  }
  type Writer = ReturnType<typeof recordWriter>;

  /** The contact may still be enrolled: campaign active, address subscribed and unclaimed. */
  function enrollable(campaign: Campaign, enrollment: Enrollment): Guard {
    const email = normalizeEmail(enrollment.contact.email);
    return (current) =>
      current.campaigns.find((item) => item.id === campaign.id)?.status ===
        'active' &&
      !isUnsubscribed(current, email) &&
      !current.enrollments.some(
        (entry) =>
          entry.id !== enrollment.id &&
          entry.campaignId === enrollment.campaignId &&
          normalizeEmail(entry.contact.email) === email &&
          !isReplaceable(entry)
      );
  }

  function openDrafts(enrollment: Enrollment) {
    return enrollment.steps.filter(
      (step) =>
        step.draftId &&
        step.status !== 'canceled' &&
        step.status !== 'delivery_started'
    );
  }

  /** Cancel every open draft in memory; the caller saves the result. */
  async function cancelDrafts(enrollment: Enrollment) {
    const open = openDrafts(enrollment);
    if (!open.length) return [];
    const status = senderStatus(enrollment.senderId);
    if (status === undefined) return [new MarketingError('inboxesLoading')];
    if (status === 'disconnected') {
      // Disconnecting an inbox deletes its scheduled emails with it, and this
      // user cannot act on drafts in an inbox that is not theirs.
      for (const step of open) step.status = 'canceled';
      enrollment.error = 'inboxDisconnected';
      return [];
    }
    const errors: unknown[] = [];
    // Last step first: a reply whose parent draft is deleted would send
    // unthreaded, so earlier steps go only after the replies to them.
    for (const step of open.reverse()) {
      try {
        step.status = await delivery.cancel(enrollment.senderId, {
          draftId: step.draftId!,
          generation: step.draftGeneration,
          threadId: step.threadId,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  /** Create and schedule every pending step, in order. Earlier steps are left as they are. */
  async function enqueue(enrollment: Enrollment, writer: Writer) {
    try {
      for (const [index, step] of enrollment.steps.entries()) {
        if (step.status !== 'pending') continue;
        if (new Date(step.sendAt).getTime() <= now().getTime() + 60_000)
          throw new MarketingError('schedulingTooSlow');
        // The parent is already scheduled, so the server accepts the reply.
        const parent = replyParent(enrollment.steps, index);
        const draft = await delivery.createDraft(enrollment.senderId, {
          email: enrollment.contact.email,
          subject:
            step.asReply && !parent
              ? standaloneSubject(step.subject)
              : step.subject,
          body: step.body,
          replyingToId: parent,
        });
        // Save the handle BEFORE scheduling so an interrupted tab can still cancel it.
        step.draftId = draft.id;
        step.draftGeneration = draft.generation;
        step.threadId = draft.threadId;
        step.status = 'scheduling';
        await writer.write();
        await delivery.schedule(
          enrollment.senderId,
          {
            draftId: draft.id,
            generation: draft.generation,
            threadId: draft.threadId,
          },
          step.sendAt
        );
        step.status = 'queued';
      }
      enrollment.status = 'scheduled';
      enrollment.error = undefined;
      await writer.write();
      return enrollment;
    } catch (error) {
      const failures = await cancelDrafts(enrollment);
      enrollment.status = 'needs_attention';
      if (enrollment.error !== 'inboxDisconnected')
        enrollment.error = failures.length ? 'cancelFailed' : 'scheduleFailed';
      try {
        await writer.settle();
      } catch {
        // The original failure is what the user needs to see; a record left
        // behind still shows as needing attention.
      }
      throw error;
    }
  }

  /** The campaign is still the active version the caller saw, and every record reads. */
  function assertEnrollable(campaign: Campaign, current: MarketingSnapshot) {
    if (current.unreadable)
      throw new MarketingError('unreadableRecords', {
        count: current.unreadable,
      });
    const saved = current.campaigns.find((item) => item.id === campaign.id);
    if (!saved || saved.status !== 'active')
      throw new MarketingError('campaignInactive');
    if (!deepEqual(saved, campaign))
      throw new MarketingError('campaignChanged');
  }

  async function enrollOne(
    campaign: Campaign,
    contact: MarketingContact,
    startAt: Date
  ) {
    const current = latest ?? (await load());
    assertEnrollable(campaign, current);
    const email = normalizeEmail(contact.email);
    if (!contactSchema.safeParse({ ...contact, email }).success)
      throw new MarketingError('invalidEmail', { email: contact.email });
    if (isUnsubscribed(current, email))
      throw new MarketingError('unsubscribed', { email });
    const prior = current.enrollments.filter(
      (entry) =>
        entry.campaignId === campaign.id &&
        normalizeEmail(entry.contact.email) === email
    );
    // Paused, stopped, and partly delivered enrollments block re-enrollment.
    if (prior.some((entry) => !isReplaceable(entry)))
      throw new MarketingError('alreadyEnrolled', { email });
    // A long batch must not run into the safety window: later contacts start later.
    const earliest = now().getTime() + MIN_START_DELAY_MS;
    const enrollment: Enrollment = {
      // Reusing a failed enrollment's id rewrites its row instead of adding one.
      id: prior[0]?.id ?? id(),
      campaignId: campaign.id,
      campaignName: campaign.name,
      contact: { ...contact, email },
      senderId: campaign.senderId,
      status: 'preparing',
      steps: planSteps(
        campaign,
        contact,
        new Date(Math.max(startAt.getTime(), earliest))
      ),
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    // The version check serializes competing reservations of one address.
    const writer = recordWriter(
      enrollment,
      prior[0],
      enrollable(campaign, enrollment)
    );
    await writer.write();
    return enqueue(enrollment, writer);
  }

  /** Enroll contacts in order, each checked against the newest load. */
  async function enrollMany(
    campaign: Campaign,
    contacts: MarketingContact[],
    startAt: Date
  ) {
    validateCampaign(campaign);
    if (campaign.status !== 'active') throw new MarketingError('activateFirst');
    if (!Number.isFinite(startAt.getTime()))
      throw new MarketingError('invalidStartTime');
    if (startAt.getTime() < now().getTime() + MIN_START_DELAY_MS)
      throw new MarketingError('startTooSoon');
    requireReadySender(campaign.senderId);
    assertEnrollable(campaign, await load());
    const enrolled: Enrollment[] = [];
    const failures: ContactFailure[] = [];
    for (const [index, contact] of contacts.entries()) {
      try {
        enrolled.push(await enrollOne(campaign, contact, startAt));
      } catch (error) {
        failures.push({ email: contact.email, error });
        if (
          error instanceof MarketingError &&
          BATCH_STOPPERS.some((code) => code === error.code)
        ) {
          for (const rest of contacts.slice(index + 1))
            failures.push({ email: rest.email, error });
          break;
        }
        // Only a conflict leaves the cached versions behind the newest load.
        if (isConflict(error)) await load();
      }
    }
    return { enrolled, failures };
  }

  async function stopSaved(saved: Enrollment, status: 'paused' | 'stopped') {
    // A stale tab must not turn a stopped contact back into a resumable one.
    if (saved.status === status) return;
    if (!STOPPABLE[status].includes(saved.status))
      throw new MarketingError(
        saved.status === 'stopped' ? 'enrollmentStopped' : 'enrollmentChanged'
      );
    // Unknown inbox state is not a cancellation failure: change nothing.
    if (openDrafts(saved).length && senderStatus(saved.senderId) === undefined)
      throw new MarketingError('inboxesLoading');
    const enrollment = structuredClone(saved);
    const writer = recordWriter(enrollment, saved, () => true);
    const failures = await cancelDrafts(enrollment);
    enrollment.status = failures.length ? 'needs_attention' : status;
    enrollment.error = failures.length
      ? 'cancelFailed'
      : enrollment.error === 'inboxDisconnected'
        ? 'inboxDisconnected'
        : undefined;
    await writer.write();
    if (failures.length)
      throw new MarketingError(
        'cancelFailed',
        {},
        failures.map((error) => ({ email: saved.contact.email, error }))
      );
  }

  /**
   * Stop one enrollment from its newest record. When a running batch elsewhere
   * changes the record first, reload and stop it again from the new state.
   */
  async function stopById(
    enrollmentId: string,
    status: 'paused' | 'stopped',
    matches: Match
  ) {
    for (let attempt = 1; ; attempt++) {
      const current = latest ?? (await load());
      const saved = current.enrollments.find(
        (item) => item.id === enrollmentId
      );
      if (!saved || !matches(saved, current)) return;
      try {
        await stopSaved(saved, status);
        return;
      } catch (error) {
        if (!isConflict(error) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
        await load();
      }
    }
  }

  /** Stop every matching enrollment, collecting failures by contact. */
  async function stopWhere(matches: Match, status: 'paused' | 'stopped') {
    const first = await load();
    const targets = first.enrollments.filter((entry) => matches(entry, first));
    const failures: ContactFailure[] = [];
    for (const target of targets) {
      try {
        await stopById(target.id, status, matches);
      } catch (error) {
        failures.push({ email: target.contact.email, error });
      }
    }
    return failures;
  }

  function throwFailures(failures: ContactFailure[]) {
    if (failures.length)
      throw new MarketingError(
        'contactsFailed',
        { count: failures.length },
        failures
      );
  }

  /** Pause the newest stored copy of a campaign, retrying around other writes. */
  async function pauseRecord(campaignId: string) {
    for (let attempt = 1; ; attempt++) {
      const stored = (await load()).campaigns.find(
        (item) => item.id === campaignId
      );
      if (!stored) throw new MarketingError('campaignChanged');
      if (stored.status === 'paused') return;
      try {
        await repository.saveCampaign({
          ...stored,
          status: 'paused',
          updatedAt: now().toISOString(),
        });
        return;
      } catch (error) {
        if (!isConflict(error) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
      }
    }
  }

  return {
    enrollMany,
    /** Stop new enrollments first, then cancel every live enrollment's drafts. */
    async pauseCampaign(campaign: Campaign) {
      await pauseRecord(campaign.id);
      throwFailures(
        await stopWhere(
          (entry) =>
            entry.campaignId === campaign.id &&
            STOPPABLE.paused.includes(entry.status),
          'paused'
        )
      );
    },
    async stop(entry: Enrollment, status: 'paused' | 'stopped') {
      const current = await load();
      if (!current.enrollments.some((item) => item.id === entry.id))
        throw new MarketingError('enrollmentMissing');
      await stopById(entry.id, status, () => true);
    },
    async resume(entry: Enrollment) {
      const current = await load();
      const saved = current.enrollments.find((item) => item.id === entry.id);
      if (!saved || saved.status !== 'paused')
        throw new MarketingError('notPaused');
      if (
        current.campaigns.find((item) => item.id === saved.campaignId)
          ?.status !== 'active'
      )
        throw new MarketingError('activateFirst');
      if (isUnsubscribed(current, saved.contact.email))
        throw new MarketingError('unsubscribed', {
          email: saved.contact.email,
        });
      requireReadySender(saved.senderId);
      const enrollment = structuredClone(saved);
      const time = now().getTime();
      // Never-sent steps: canceled by the pause, or never drafted because the
      // pause landed mid-scheduling. Past-due ones are skipped, not sent late.
      const remaining = enrollment.steps.filter(
        (step) =>
          (step.status === 'canceled' || step.status === 'pending') &&
          new Date(step.sendAt).getTime() > time
      );
      if (!remaining.length) throw new MarketingError('nothingToResume');
      const moved = new Map(
        rescheduleSteps(
          remaining,
          new Date(time + MIN_START_DELAY_MS + 60_000)
        ).map((step) => [step.id, step.sendAt])
      );
      enrollment.steps = enrollment.steps.map((step) => {
        const sendAt = moved.get(step.id);
        if (sendAt)
          return {
            ...step,
            draftId: undefined,
            draftGeneration: undefined,
            threadId: undefined,
            status: 'pending',
            sendAt,
          };
        // Skipped steps keep their history but are never queued again.
        return step.status === 'pending'
          ? { ...step, status: 'canceled' }
          : step;
      });
      enrollment.status = 'preparing';
      enrollment.error = undefined;
      const writer = recordWriter(
        enrollment,
        saved,
        (fresh) =>
          fresh.campaigns.find((item) => item.id === saved.campaignId)
            ?.status === 'active' && !isUnsubscribed(fresh, saved.contact.email)
      );
      await writer.write();
      return enqueue(enrollment, writer);
    },
    /**
     * Stop every enrollment, then remove the campaign and its records. Sends
     * already handed to Gmail cannot be recalled; nothing else is left queued.
     */
    async deleteCampaign(campaign: Campaign) {
      const current = await load();
      // An unreadable record may belong to this campaign and still be sending.
      if (current.unreadable)
        throw new MarketingError('unreadableRecords', {
          count: current.unreadable,
        });
      if (!current.campaigns.some((item) => item.id === campaign.id)) return;
      await pauseRecord(campaign.id);
      throwFailures(
        await stopWhere(
          (entry) =>
            entry.campaignId === campaign.id && entry.status !== 'stopped',
          'stopped'
        )
      );
      const entries = (await load()).enrollments.filter(
        (entry) => entry.campaignId === campaign.id
      );
      // Someone enrolled a contact meanwhile; stop it before deleting.
      if (entries.some((entry) => entry.status !== 'stopped'))
        throw new MarketingError('campaignChanged');
      await repository.deleteCampaign(
        campaign.id,
        entries.map((entry) => entry.id)
      );
    },
    /** Record the address as unsubscribed everywhere, then stop its enrollments. */
    async unsubscribe(email: string) {
      const address = normalizeEmail(email);
      const entry = { email: address, unsubscribedAt: now().toISOString() };
      for (let attempt = 1; ; attempt++) {
        if (isUnsubscribed(await load(), address)) break;
        try {
          await repository.saveUnsubscribe(entry);
          break;
        } catch (error) {
          // The record is idempotent, so retry around unrelated writes.
          if (!isConflict(error) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
        }
      }
      throwFailures(
        await stopWhere(
          (enrollment) =>
            normalizeEmail(enrollment.contact.email) === address &&
            enrollment.status !== 'stopped',
          'stopped'
        )
      );
    },
    /** Stop enrollments whose campaign record is gone, so nothing sends unseen. */
    async stopOrphans() {
      throwFailures(
        await stopWhere(
          (entry, current) =>
            entry.status !== 'stopped' &&
            !current.campaigns.some((item) => item.id === entry.campaignId),
          'stopped'
        )
      );
    },
    /** Cancel scheduled sequence emails that no enrollment record knows about. */
    async cancelUntracked(senderId: string, draftIds: string[]) {
      requireReadySender(senderId);
      // Recheck against a fresh load: a step recorded since is not untracked.
      const known = new Set(
        (await load()).enrollments.flatMap((entry) =>
          entry.steps.flatMap((step) =>
            step.draftId &&
            (step.status === 'queued' || step.status === 'scheduling')
              ? step.draftId
              : []
          )
        )
      );
      const errors: unknown[] = [];
      for (const draftId of draftIds) {
        if (known.has(draftId)) continue;
        try {
          await delivery.cancel(senderId, { draftId });
        } catch (error) {
          errors.push(error);
        }
      }
      // No contact to name: these emails have no record.
      if (errors.length)
        throw new MarketingError(
          'cancelFailed',
          {},
          errors.map((error) => ({ email: '', error }))
        );
    },
  };
}
export type SequenceEngine = ReturnType<typeof createSequenceEngine>;
