import { createSignal } from 'solid-js';
import type { MarketingCapabilities } from '../context/contracts';
import {
  type Campaign,
  type MarketingContact,
  type MarketingSnapshot,
  type Sender,
  validateCampaign,
} from '../core/model';
import { createSequenceEngine } from './sequence-engine';

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
  const [senders, setSenders] = createSignal<Sender[]>([]);
  const engine = createSequenceEngine(
    capabilities.repository,
    capabilities.delivery
  );

  async function refresh() {
    setSnapshot(await capabilities.repository.load());
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
      if (
        !senders().some(
          (sender) => sender.id === campaign.senderId && sender.ready
        )
      )
        throw new Error('Reconnect this Gmail inbox before activating.');
    }
    await capabilities.repository.saveCampaign({
      ...campaign,
      status: activate ? 'active' : campaign.status,
      updatedAt: new Date().toISOString(),
    });
  }
  async function pause(campaign: Campaign) {
    // Stop new enrollments first, then cancel every tracked draft.
    await capabilities.repository.saveCampaign({
      ...campaign,
      status: 'paused',
      updatedAt: new Date().toISOString(),
    });
    const failures: string[] = [];
    for (const enrollment of snapshot().enrollments.filter(
      (entry) =>
        entry.campaignId === campaign.id &&
        ['scheduled', 'preparing', 'needs_attention'].includes(entry.status)
    )) {
      try {
        await engine.stop(enrollment, 'paused');
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : String(cause));
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  }
  async function enroll(
    campaign: Campaign,
    selected: MarketingContact[],
    startAt: Date
  ) {
    const failures: string[] = [];
    for (const contact of selected) {
      try {
        await engine.enroll(campaign, contact, startAt);
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : String(cause));
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  }
  return {
    snapshot,
    loading,
    busy,
    error,
    notice,
    contacts,
    senders,
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
