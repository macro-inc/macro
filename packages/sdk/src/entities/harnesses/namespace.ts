import type { CreatePairingRequest } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { AgentSession } from '../agent-sessions/agent-session';
import { Agent } from '../agents/agent';
import { Harness } from './harness';
import { DevicePairing, HarnessPairing } from './pairing';

/** Hosts and device pairing. Self operations require host credentials. */
export class HarnessNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy host handle. */
  byId(id: string): Harness {
    return Harness.byId(this.client, id);
  }

  /** All hosts visible to the caller. */
  async list(): Promise<Harness[]> {
    return unwrap(await this.client.storage.listHarnesses()).map((h) =>
      Harness.from(this.client, h),
    );
  }

  /** The currently authenticated host. */
  async me(): Promise<Harness> {
    return Harness.from(
      this.client,
      unwrap(await this.client.storage.getSelfHarness()),
    );
  }

  /** Revoke the currently authenticated host. */
  async deleteSelf(): Promise<void> {
    unwrap(await this.client.storage.deleteSelfHarness());
  }

  /** Agent handles for the currently authenticated host. */
  async agents(): Promise<Agent[]> {
    return unwrap(await this.client.storage.listHarnessAgents()).map((a) =>
      Agent.byId(this.client, a.bot_id),
    );
  }

  /** Session handles for the currently authenticated host. */
  async sessions(): Promise<AgentSession[]> {
    return unwrap(await this.client.storage.listHarnessSessions()).map((s) =>
      AgentSession.byId(this.client, s.session_id),
    );
  }

  /** Construct a lazy pairing from its displayed code. */
  pairing(code: string): HarnessPairing {
    return HarnessPairing.byId(this.client, code);
  }

  /** Start pairing a device; persist the secret separately from the handles. */
  async createPairing(options: CreatePairingRequest) {
    const record = unwrap(
      await this.client.storage.createHarnessPairing({ body: options }),
    );
    return {
      pairing: HarnessPairing.byId(this.client, record.code),
      device: DevicePairing.byId(this.client, record.pairing_id),
      deviceSecret: record.device_secret,
      expiresAt: record.expires_at,
      pollIntervalSeconds: record.poll_interval_seconds,
    };
  }
}
