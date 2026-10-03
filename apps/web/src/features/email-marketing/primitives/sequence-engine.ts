import type {
  MarketingRepository,
  SequenceDelivery,
} from '../context/contracts';
import {
  type Campaign,
  contactSchema,
  type Enrollment,
  type MarketingContact,
  MIN_START_DELAY_MS,
  normalizeEmail,
  planSteps,
  validateCampaign,
} from '../core/model';

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Uses the existing server scheduler. No timers, sending secrets, or browser-open requirement. */
export function createSequenceEngine(
  repository: MarketingRepository,
  delivery: SequenceDelivery,
  now = () => new Date(),
  id: () => string = () => crypto.randomUUID()
) {
  async function persist(enrollment: Enrollment) {
    enrollment.updatedAt = now().toISOString();
    await repository.saveEnrollment(structuredClone(enrollment));
  }

  async function cancelDrafts(enrollment: Enrollment) {
    const errors: string[] = [];
    for (const step of enrollment.steps) {
      if (
        !step.draftId ||
        step.status === 'canceled' ||
        step.status === 'delivery_started'
      )
        continue;
      try {
        step.status = await delivery.cancel(enrollment.senderId, step.draftId);
        await persist(enrollment);
      } catch (error) {
        errors.push(message(error));
      }
    }
    return errors;
  }

  async function enqueue(enrollment: Enrollment) {
    try {
      for (const step of enrollment.steps) {
        if (new Date(step.sendAt).getTime() <= now().getTime() + 60_000)
          throw new Error(
            'Scheduling took too long. Choose a later start time.'
          );
        // Save the handle BEFORE scheduling so interrupted requests remain recoverable.
        step.draftId = await delivery.createDraft(
          enrollment.senderId,
          enrollment.contact.email,
          step.subject,
          step.body
        );
        step.status = 'scheduling';
        await persist(enrollment);
        await delivery.schedule(enrollment.senderId, step.draftId, step.sendAt);
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

  return {
    async enroll(campaign: Campaign, contact: MarketingContact, startAt: Date) {
      contactSchema.parse({ ...contact, email: normalizeEmail(contact.email) });
      validateCampaign(campaign);
      if (campaign.status !== 'active')
        throw new Error('Activate the campaign before enrolling contacts.');
      if (startAt.getTime() < now().getTime() + MIN_START_DELAY_MS)
        throw new Error('Choose a start time at least 10 minutes from now.');
      const current = await repository.load();
      const savedCampaign = current.campaigns.find(
        (item) => item.id === campaign.id
      );
      if (!savedCampaign || savedCampaign.status !== 'active')
        throw new Error(
          'This campaign is no longer active. Refresh before enrolling.'
        );
      if (JSON.stringify(savedCampaign) !== JSON.stringify(campaign))
        throw new Error('This campaign changed. Refresh before enrolling.');
      // Paused, stopped, and failed enrollments also block accidental re-enrollment.
      if (
        current.enrollments.some(
          (entry) =>
            entry.campaignId === campaign.id &&
            normalizeEmail(entry.contact.email) ===
              normalizeEmail(contact.email)
        )
      )
        throw new Error(
          `${contact.email} is already enrolled in this campaign.`
        );
      const enrollment: Enrollment = {
        id: id(),
        campaignId: campaign.id,
        campaignName: campaign.name,
        contact: { ...contact, email: normalizeEmail(contact.email) },
        senderId: campaign.senderId,
        status: 'preparing',
        steps: planSteps(campaign, contact, startAt),
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      };
      // Repository's version check serializes competing enrollment reservations.
      await persist(enrollment);
      return enqueue(enrollment);
    },
    async stop(entry: Enrollment, status: 'paused' | 'stopped') {
      const current = await repository.load();
      const saved = current.enrollments.find((item) => item.id === entry.id);
      if (!saved) throw new Error('This enrollment no longer exists.');
      const enrollment = structuredClone(saved);
      const failures = await cancelDrafts(enrollment);
      enrollment.status = failures.length ? 'needs_attention' : status;
      enrollment.error = failures.length
        ? `Some drafts could not be canceled: ${failures.join('; ')}`
        : undefined;
      await persist(enrollment);
      if (failures.length) throw new Error(enrollment.error);
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
      const enrollment = structuredClone(saved);
      // Past-due steps may already have been delivered; never send them again.
      enrollment.steps = enrollment.steps.filter(
        (step) =>
          step.status === 'canceled' &&
          new Date(step.sendAt).getTime() > now().getTime()
      );
      if (!enrollment.steps.length)
        throw new Error('There are no future emails to resume.');
      let time = now().getTime() + MIN_START_DELAY_MS + 60_000;
      enrollment.steps = enrollment.steps.map((step, index) => {
        if (index > 0) time += step.delayDays * 86_400_000;
        return {
          ...step,
          draftId: undefined,
          status: 'pending',
          sendAt: new Date(time).toISOString(),
        };
      });
      enrollment.status = 'preparing';
      await persist(enrollment);
      return enqueue(enrollment);
    },
  };
}
