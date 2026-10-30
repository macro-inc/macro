import { deepEqual } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { createSignal } from 'solid-js';
import type { MarketingCapabilities } from '../context/contracts';
import {
  attentionFor,
  collectIssues,
  inspectionTargets,
  needsAttention,
  senderStatusOf,
} from '../core/attention';
import { MarketingError } from '../core/errors';
import {
  type Campaign,
  type DeliveryIssue,
  EMPTY_SNAPSHOT,
  type Enrollment,
  type MarketingContact,
  type MarketingSnapshot,
  type QueuedStep,
  type Sender,
  validateCampaign,
} from '../core/model';
import { createSequenceEngine } from './sequence-engine';

export function createMarketingWorkspace(capabilities: MarketingCapabilities) {
  // Nothing is writable until a load says so.
  const [snapshot, setSnapshot] = createSignal<MarketingSnapshot>({
    ...EMPTY_SNAPSHOT,
    writable: false,
  });
  /** Set once the first load settles, whether or not it succeeded. */
  const [settled, setSettled] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  const [contacts, setContacts] = createSignal<MarketingContact[]>([]);
  const [senders, setSenders] = createSignal<Sender[]>();
  const [issues, setIssues] = createSignal<Record<string, DeliveryIssue>>({});
  /** Scheduled sequence emails no record tracks, by inbox. */
  const [untracked, setUntracked] = createSignal<Record<string, string[]>>({});
  let inspection = 0;

  const senderStatus = (senderId: string) =>
    senderStatusOf(senders(), senderId);
  const stepIssue = (step: QueuedStep): DeliveryIssue | undefined =>
    step.draftId ? issues()[step.draftId] : undefined;
  const enrollmentAttention = (entry: Enrollment) =>
    attentionFor(entry, senderStatus, issues());
  /** Enrollments in a campaign that need the user. */
  const campaignAttention = (campaignId: string) =>
    snapshot().enrollments.filter(
      (entry) =>
        entry.campaignId === campaignId &&
        needsAttention(entry, senderStatus, issues())
    ).length;

  const engine = createSequenceEngine(
    capabilities.repository,
    capabilities.delivery,
    { senderStatus }
  );

  /**
   * Read the scheduler for every inbox the user still has, even one with no
   * queued steps: emails whose records were lost show up there. Non-fatal.
   */
  function inspectDelivery(data: MarketingSnapshot) {
    const bySender = inspectionTargets(data.enrollments, senderStatus);
    for (const sender of senders() ?? [])
      if (!bySender.has(sender.id)) bySender.set(sender.id, []);
    const run = ++inspection;
    if (!bySender.size) {
      setIssues({});
      setUntracked({});
      return;
    }
    fireAndForget(
      Telemetry.span('email_marketing.inspect', async (span) => {
        span.setAttr('email_marketing.inboxes', bySender.size);
        const result = await collectIssues(
          capabilities.delivery.inspect,
          bySender
        );
        span.setAttr(
          'email_marketing.issues',
          Object.keys(result.found).length
        );
        if (run !== inspection) return;
        setIssues(result.found);
        setUntracked(result.untracked);
        if (result.failed) throw result.failed.reason;
      }),
      'email-marketing.inspect'
    );
  }

  async function refresh() {
    const data = await capabilities.repository.load();
    setSnapshot(data);
    setLoaded(true);
    inspectDelivery(data);
  }
  /** Load everything; a retry keeps what is on screen while it runs. */
  async function initialize() {
    setError(undefined);
    // Contacts are optional: without them the workspace still manages sends.
    const [data, people, inboxes] = await Promise.allSettled([
      capabilities.repository.load(),
      capabilities.loadContacts(),
      capabilities.loadSenders(),
    ]);
    if (inboxes.status === 'fulfilled') setSenders(inboxes.value);
    if (people.status === 'fulfilled') setContacts(people.value);
    if (data.status === 'fulfilled') {
      setSnapshot(data.value);
      setLoaded(true);
      inspectDelivery(data.value);
    }
    const failed = [data, inboxes, people].find(
      (result) => result.status === 'rejected'
    );
    if (failed?.status === 'rejected') setError(failed.reason);
    setSettled(true);
  }
  /**
   * Run one user action at a time in its own span, then reload so every view
   * matches storage. Spans carry ids and counts, never addresses or content.
   */
  async function run(
    name: string,
    action: () => Promise<void>,
    attributes: Record<string, string | number> = {}
  ) {
    if (busy()) return false;
    setBusy(true);
    setError(undefined);
    let succeeded = false;
    try {
      await Telemetry.span(`email_marketing.${name}`, async (span) => {
        for (const [key, value] of Object.entries(attributes))
          span.setAttr(`email_marketing.${key}`, value);
        try {
          await action();
        } catch (cause) {
          span.error(cause);
          if (cause instanceof MarketingError) {
            span.setAttr('email_marketing.error', cause.code);
            span.setAttr('email_marketing.failures', cause.failures.length);
          }
          throw cause;
        }
      });
      succeeded = true;
    } catch (cause) {
      setError(cause);
    } finally {
      try {
        await refresh();
      } catch (cause) {
        succeeded = false;
        setError(cause);
      }
      setBusy(false);
    }
    return succeeded;
  }
  /**
   * Save an edited campaign. `base` is the stored copy the edits started from;
   * a campaign changed or deleted elsewhere since then is not overwritten.
   */
  async function save(
    campaign: Campaign,
    activate: boolean,
    base: Campaign | undefined
  ) {
    if (activate) {
      validateCampaign(campaign);
      const status = senderStatus(campaign.senderId);
      if (status !== 'ready')
        throw new MarketingError(
          status === 'disconnected' ? 'inboxDisconnected' : 'inboxReauth'
        );
    }
    // The all-table version check makes this load and the write one step.
    const stored = (await capabilities.repository.load()).campaigns.find(
      (item) => item.id === campaign.id
    );
    if (base ? !deepEqual(stored, base) : stored)
      throw new MarketingError('campaignChanged');
    await capabilities.repository.saveCampaign({
      ...campaign,
      status: activate ? 'active' : campaign.status,
      updatedAt: new Date().toISOString(),
    });
  }
  async function enroll(
    campaign: Campaign,
    selected: MarketingContact[],
    startAt: Date
  ) {
    const { failures } = await engine.enrollMany(campaign, selected, startAt);
    if (failures.length)
      throw new MarketingError(
        'contactsFailed',
        { count: failures.length },
        failures
      );
  }
  return {
    snapshot,
    /** The first load is still running. */
    loading: () => !settled(),
    /** Records have loaded at least once. */
    loaded,
    busy,
    error,
    dismissError: () => setError(undefined),
    contacts,
    senders: () => senders() ?? [],
    senderStatus,
    untracked,
    stepIssue,
    enrollmentAttention,
    campaignAttention,
    initialize,
    run,
    save,
    enroll,
    engine,
  };
}
export type MarketingWorkspace = ReturnType<typeof createMarketingWorkspace>;
