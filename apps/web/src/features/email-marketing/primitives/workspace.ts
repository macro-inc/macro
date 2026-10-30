import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal } from 'solid-js';
import type { DraftRef, MarketingCapabilities } from '../context/contracts';
import type {
  AttentionReason,
  Campaign,
  DeliveryIssue,
  Enrollment,
  MarketingContact,
  MarketingSnapshot,
  QueuedStep,
  Sender,
  SenderStatus,
} from '../core/model';
import { validateCampaign } from '../core/model';
import { createSequenceEngine } from './sequence-engine';

type InspectTarget = DraftRef & { sendAt: string };

export function createMarketingWorkspace(capabilities: MarketingCapabilities) {
  const [snapshot, setSnapshot] = createSignal<MarketingSnapshot>({
    campaigns: [],
    enrollments: [],
    writable: false,
  });
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [contacts, setContacts] = createSignal<MarketingContact[]>([]);
  const [senders, setSenders] = createSignal<Sender[]>();
  const [issues, setIssues] = createSignal<Record<string, DeliveryIssue>>({});
  let inspection = 0;

  /** `undefined` until the user's inboxes have loaded. */
  function senderStatus(senderId: string): SenderStatus | undefined {
    const inboxes = senders();
    if (!inboxes) return undefined;
    const sender = inboxes.find((item) => item.id === senderId);
    if (!sender) return 'disconnected';
    return sender.ready ? 'ready' : 'reauth';
  }
  /** A queued step's scheduler problem, when the last inspection found one. */
  function stepIssue(step: QueuedStep): DeliveryIssue | undefined {
    return step.draftId ? issues()[step.draftId] : undefined;
  }
  /**
   * The most pressing problem with an enrollment that its stored status does
   * not show: a disconnected inbox, then the first step the scheduler flags.
   */
  function enrollmentAttention(entry: Enrollment): AttentionReason | undefined {
    const live =
      entry.status === 'preparing' ||
      entry.status === 'scheduled' ||
      entry.status === 'needs_attention';
    if (live && senderStatus(entry.senderId) === 'disconnected')
      return 'disconnected';
    for (const step of entry.steps) {
      const issue = stepIssue(step);
      if (issue) return issue;
    }
    return undefined;
  }

  const engine = createSequenceEngine(
    capabilities.repository,
    capabilities.delivery,
    { senderStatus }
  );

  /** Read scheduler state for queued steps in the user's own inboxes. Non-fatal. */
  function inspectDelivery(data: MarketingSnapshot) {
    const inspect = capabilities.delivery.inspect;
    if (!inspect) return;
    const bySender = new Map<string, InspectTarget[]>();
    for (const entry of data.enrollments) {
      const status = senderStatus(entry.senderId);
      if (status !== 'ready' && status !== 'reauth') continue;
      for (const step of entry.steps) {
        if (step.status !== 'queued' || !step.draftId) continue;
        const targets = bySender.get(entry.senderId) ?? [];
        targets.push({
          draftId: step.draftId,
          generation: step.draftGeneration,
          threadId: step.threadId,
          sendAt: step.sendAt,
        });
        bySender.set(entry.senderId, targets);
      }
    }
    const run = ++inspection;
    if (!bySender.size) {
      setIssues({});
      return;
    }
    fireAndForget(
      collectIssues(inspect, bySender, run),
      'email-marketing.inspect'
    );
  }
  async function collectIssues(
    inspect: NonNullable<MarketingCapabilities['delivery']['inspect']>,
    bySender: Map<string, InspectTarget[]>,
    run: number
  ) {
    const results = await Promise.allSettled(
      [...bySender].map(([senderId, steps]) => inspect(senderId, steps))
    );
    if (run !== inspection) return;
    const found: Record<string, DeliveryIssue> = {};
    for (const result of results)
      if (result.status === 'fulfilled') Object.assign(found, result.value);
    setIssues(found);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }

  async function refresh() {
    const data = await capabilities.repository.load();
    setSnapshot(data);
    inspectDelivery(data);
  }
  async function initialize() {
    setLoading(true);
    setError('');
    try {
      const [data, people, inboxes] = await Promise.all([
        capabilities.repository.load(),
        capabilities.loadContacts(),
        capabilities.loadSenders(),
      ]);
      setSnapshot(data);
      setContacts(people);
      setSenders(inboxes);
      inspectDelivery(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  async function run(action: () => Promise<void>, success: string) {
    if (busy()) return false;
    setBusy(true);
    setError('');
    setNotice('');
    let succeeded = false;
    try {
      await action();
      succeeded = true;
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      try {
        await refresh();
      } catch (cause) {
        succeeded = false;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      setBusy(false);
    }
    return succeeded;
  }
  async function save(campaign: Campaign, activate: boolean) {
    if (activate) {
      validateCampaign(campaign);
      if (senderStatus(campaign.senderId) !== 'ready')
        throw new Error('Reconnect this Gmail inbox before activating.');
    }
    await capabilities.repository.saveCampaign({
      ...campaign,
      status: activate ? 'active' : campaign.status,
      updatedAt: new Date().toISOString(),
    });
  }
  async function pause(campaign: Campaign) {
    // Stop new enrollments first, then cancel every tracked draft. Read the
    // enrollments fresh: another tab may have enrolled people since our snapshot.
    await capabilities.repository.saveCampaign({
      ...campaign,
      status: 'paused',
      updatedAt: new Date().toISOString(),
    });
    const failures = await engine.stopWhere(
      (entry) =>
        entry.campaignId === campaign.id &&
        ['scheduled', 'preparing', 'needs_attention'].includes(entry.status),
      'paused'
    );
    if (failures.length) throw new Error(failures.join('; '));
  }
  async function enroll(
    campaign: Campaign,
    selected: MarketingContact[],
    startAt: Date
  ) {
    const { failures } = await engine.enrollMany(campaign, selected, startAt);
    if (failures.length)
      throw new Error(
        failures
          .map((failure) =>
            failure.message.includes(failure.email)
              ? failure.message
              : `${failure.email}: ${failure.message}`
          )
          .join('; ')
      );
  }
  return {
    snapshot,
    loading,
    busy,
    error,
    notice,
    contacts,
    senders: () => senders() ?? [],
    senderStatus,
    issues,
    stepIssue,
    enrollmentAttention,
    initialize,
    refresh,
    run,
    save,
    pause,
    enroll,
    engine,
    capabilities,
  };
}
export type MarketingWorkspace = ReturnType<typeof createMarketingWorkspace>;
