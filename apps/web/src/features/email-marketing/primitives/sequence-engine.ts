import { deepEqual } from '@core/util/compareUtils';
import type {
  MarketingRepository,
  SequenceDelivery,
} from '../context/contracts';
import {
  type Campaign,
  contactSchema,
  type Enrollment,
  type MarketingContact,
  type MarketingSnapshot,
  MIN_START_DELAY_MS,
  normalizeEmail,
  planSteps,
  rescheduleSteps,
  type SenderStatus,
  validateCampaign,
} from '../core/model';

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export type EngineOptions = {
  now?: () => Date;
  id?: () => string;
  /**
   * The signed-in user's view of an inbox; `undefined` while inboxes are
   * still loading. Omit to trust every sender (tests and fixtures).
   */
  senderStatus?: (senderId: string) => SenderStatus | undefined;
};

export type EnrollmentFailure = { email: string; message: string };

/** Statuses a stop may move from, per requested target. */
const STOPPABLE: Record<'paused' | 'stopped', Enrollment['status'][]> = {
  paused: ['preparing', 'scheduled', 'needs_attention'],
  stopped: ['preparing', 'scheduled', 'needs_attention', 'paused'],
};

const INBOXES_LOADING =
  'Your inboxes are still loading. Try again in a moment.';
const DISCONNECTED_NOTE =
  'The inbox was disconnected, so its scheduled emails were removed.';

/**
 * A failed enrollment with nothing queued or delivered can be replaced by a
 * fresh one. Paused and stopped enrollments still block, by design.
 */
function isReplaceable(entry: Enrollment) {
  return (
    entry.status === 'needs_attention' &&
    entry.steps.every(
      (step) => step.status === 'pending' || step.status === 'canceled'
    )
  );
}

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

  function requireReadySender(senderId: string) {
    const status = senderStatus(senderId);
    if (status === 'ready') return;
    throw new Error(
      status === 'disconnected'
        ? 'This campaign’s Gmail inbox is no longer connected to your account.'
        : status === 'reauth'
          ? 'Reconnect this Gmail inbox before sending.'
          : INBOXES_LOADING
    );
  }

  async function persist(enrollment: Enrollment) {
    enrollment.updatedAt = now().toISOString();
    await repository.saveEnrollment(structuredClone(enrollment));
  }

  function openDrafts(enrollment: Enrollment) {
    return enrollment.steps.filter(
      (step) =>
        step.draftId &&
        step.status !== 'canceled' &&
        step.status !== 'delivery_started'
    );
  }

  async function cancelDrafts(enrollment: Enrollment) {
    const open = openDrafts(enrollment);
    if (!open.length) return [];
    const status = senderStatus(enrollment.senderId);
    if (status === undefined) return [INBOXES_LOADING];
    if (status === 'disconnected') {
      // Disconnecting an inbox deletes its scheduled emails with it, and this
      // user cannot act on drafts in an inbox that is not theirs.
      for (const step of open) step.status = 'canceled';
      enrollment.error = DISCONNECTED_NOTE;
      await persist(enrollment);
      return [];
    }
    const errors: string[] = [];
    for (const step of open) {
      try {
        step.status = await delivery.cancel(enrollment.senderId, {
          draftId: step.draftId!,
          generation: step.draftGeneration,
          threadId: step.threadId,
        });
        await persist(enrollment);
      } catch (error) {
        errors.push(message(error));
      }
    }
    return errors;
  }

  /** Create and schedule every pending step. Earlier steps are left as they are. */
  async function enqueue(enrollment: Enrollment) {
    try {
      for (const step of enrollment.steps) {
        if (step.status !== 'pending') continue;
        if (new Date(step.sendAt).getTime() <= now().getTime() + 60_000)
          throw new Error(
            'Scheduling took too long. Choose a later start time.'
          );
        const draft = await delivery.createDraft(
          enrollment.senderId,
          enrollment.contact.email,
          step.subject,
          step.body
        );
        // Save the handle BEFORE scheduling so interrupted requests remain recoverable.
        step.draftId = draft.id;
        step.draftGeneration = draft.generation;
        step.threadId = draft.threadId;
        step.status = 'scheduling';
        await persist(enrollment);
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
        await persist(enrollment);
      }
      enrollment.status = 'scheduled';
      enrollment.error = undefined;
      await persist(enrollment);
      return enrollment;
    } catch (error) {
      const failures = await cancelDrafts(enrollment);
      enrollment.status = 'needs_attention';
      enrollment.error = `${message(error)}${failures.length ? ` Cancellation needs attention: ${failures.join('; ')}` : ' Pending drafts were canceled.'}`;
      await persist(enrollment);
      throw new Error(enrollment.error);
    }
  }

  /** Load and confirm the campaign is still the active version the caller saw. */
  async function loadForEnrollment(campaign: Campaign) {
    const current = await repository.load();
    const saved = current.campaigns.find((item) => item.id === campaign.id);
    if (!saved || saved.status !== 'active')
      throw new Error(
        'This campaign is no longer active. Refresh before enrolling.'
      );
    if (!deepEqual(saved, campaign))
      throw new Error('This campaign changed. Refresh before enrolling.');
    return current;
  }

  async function enrollOne(
    campaign: Campaign,
    contact: MarketingContact,
    startAt: Date,
    current: MarketingSnapshot
  ) {
    const email = normalizeEmail(contact.email);
    contactSchema.parse({ ...contact, email });
    const prior = current.enrollments.filter(
      (entry) =>
        entry.campaignId === campaign.id &&
        normalizeEmail(entry.contact.email) === email
    );
    // Paused, stopped, and partly delivered enrollments block re-enrollment.
    if (prior.some((entry) => !isReplaceable(entry)))
      throw new Error(`${email} is already enrolled in this campaign.`);
    const enrollment: Enrollment = {
      // Reusing a failed enrollment's id rewrites its row instead of adding one.
      id: prior[0]?.id ?? id(),
      campaignId: campaign.id,
      campaignName: campaign.name,
      contact: { ...contact, email },
      senderId: campaign.senderId,
      status: 'preparing',
      steps: planSteps(campaign, contact, startAt),
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    // Repository's version check serializes competing enrollment reservations.
    await persist(enrollment);
    current.enrollments = [
      ...current.enrollments.filter((entry) => entry.id !== enrollment.id),
      enrollment,
    ];
    return enqueue(enrollment);
  }

  /**
   * Enroll contacts with one load. After a failure the row versions may be
   * stale, so the snapshot reloads before the next contact.
   */
  async function enrollMany(
    campaign: Campaign,
    contacts: MarketingContact[],
    startAt: Date
  ) {
    validateCampaign(campaign);
    if (campaign.status !== 'active')
      throw new Error('Activate the campaign before enrolling contacts.');
    if (startAt.getTime() < now().getTime() + MIN_START_DELAY_MS)
      throw new Error('Choose a start time at least 10 minutes from now.');
    requireReadySender(campaign.senderId);
    let current = await loadForEnrollment(campaign);
    const enrolled: Enrollment[] = [];
    const failures: EnrollmentFailure[] = [];
    for (const [index, contact] of contacts.entries()) {
      try {
        enrolled.push(await enrollOne(campaign, contact, startAt, current));
      } catch (error) {
        failures.push({ email: contact.email, message: message(error) });
        if (index === contacts.length - 1) break;
        try {
          current = await loadForEnrollment(campaign);
        } catch (reload) {
          for (const rest of contacts.slice(index + 1))
            failures.push({ email: rest.email, message: message(reload) });
          break;
        }
      }
    }
    return { enrolled, failures };
  }

  async function stopSaved(saved: Enrollment, status: 'paused' | 'stopped') {
    // A stale tab must not turn a stopped contact back into a resumable one.
    if (saved.status === status) return;
    if (!STOPPABLE[status].includes(saved.status))
      throw new Error(
        saved.status === 'stopped'
          ? 'This enrollment was already stopped.'
          : 'This enrollment changed. Refresh and try again.'
      );
    // Unknown inbox state is not a cancellation failure: change nothing.
    if (openDrafts(saved).length && senderStatus(saved.senderId) === undefined)
      throw new Error(INBOXES_LOADING);
    const enrollment = structuredClone(saved);
    const failures = await cancelDrafts(enrollment);
    enrollment.status = failures.length ? 'needs_attention' : status;
    enrollment.error = failures.length
      ? `Some drafts could not be canceled: ${failures.join('; ')}`
      : enrollment.error === DISCONNECTED_NOTE
        ? DISCONNECTED_NOTE
        : undefined;
    await persist(enrollment);
    if (failures.length) throw new Error(enrollment.error);
  }

  return {
    async enroll(campaign: Campaign, contact: MarketingContact, startAt: Date) {
      const { enrolled, failures } = await enrollMany(
        campaign,
        [contact],
        startAt
      );
      if (failures.length) throw new Error(failures[0].message);
      return enrolled[0];
    },
    enrollMany,
    async stop(entry: Enrollment, status: 'paused' | 'stopped') {
      const current = await repository.load();
      const saved = current.enrollments.find((item) => item.id === entry.id);
      if (!saved) throw new Error('This enrollment no longer exists.');
      await stopSaved(saved, status);
    },
    /** Stop every matching enrollment from one fresh load. */
    async stopWhere(
      matches: (entry: Enrollment) => boolean,
      status: 'paused' | 'stopped'
    ) {
      let current = await repository.load();
      const ids = current.enrollments.filter(matches).map((entry) => entry.id);
      const failures: string[] = [];
      for (const enrollmentId of ids) {
        const saved = current.enrollments.find(
          (item) => item.id === enrollmentId
        );
        if (!saved || !matches(saved)) continue;
        try {
          await stopSaved(saved, status);
        } catch (error) {
          failures.push(`${saved.contact.email}: ${message(error)}`);
          // Versions may be stale after a failed write.
          current = await repository.load();
        }
      }
      return failures;
    },
    async resume(entry: Enrollment) {
      const current = await repository.load();
      const saved = current.enrollments.find((item) => item.id === entry.id);
      if (!saved || saved.status !== 'paused')
        throw new Error('Only paused enrollments can be resumed.');
      if (
        current.campaigns.find((campaign) => campaign.id === saved.campaignId)
          ?.status !== 'active'
      )
        throw new Error(
          'Activate the campaign before resuming this enrollment.'
        );
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
      if (!remaining.length)
        throw new Error('There are no future emails to resume.');
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
      await persist(enrollment);
      return enqueue(enrollment);
    },
  };
}
