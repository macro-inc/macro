import type { CreatePairingRequest } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { AgentSession } from '../agent-sessions/agent-session';
import { Agent } from '../agents/agent';
import { Harness } from './harness';
import { DevicePairing, HarnessPairing } from './pairing';

/**
 * Hosts and device pairing. Self operations require host credentials.
 *
 * @routing Use when listing, pairing or removing the machines (hosts) that run the user's agents; not changing an agent persona's setup (`macro.agents`).
 */
export class HarnessNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy host handle. */
  byId(id: string): Harness {
    return Harness.byId(this.client, id);
  }

  /**
   * The hosts the caller may run agents on.
   *
   * @readonly
   */
  async list(): Promise<Harness[]> {
    return unwrap(await this.client.storage.listHarnesses()).map((h) =>
      Harness.from(this.client, h),
    );
  }

  /**
   * Every host of the caller's teammates, including ones the caller cannot use
   * yet. `Harness.callerAccess()` says which, and `Harness.requestAccess()` asks.
   *
   * @readonly
   */
  async directory(): Promise<Harness[]> {
    return unwrap(await this.client.storage.listHarnessDirectory()).map((h) =>
      Harness.from(this.client, h),
    );
  }

  /**
   * The currently authenticated host.
   *
   * @readonly
   * @mcp-exclude Requires host credentials
   * MCP calls authenticate as a user.
   */
  async me(): Promise<Harness> {
    return Harness.from(
      this.client,
      unwrap(await this.client.storage.getSelfHarness()),
    );
  }

  /**
   * Revoke the currently authenticated host.
   *
   * @destructive
   * @idempotent
   * @mcp-exclude Requires host credentials
   * MCP calls authenticate as a user.
   */
  async deleteSelf(): Promise<void> {
    unwrap(await this.client.storage.deleteSelfHarness());
  }

  /**
   * Agent handles for the currently authenticated host.
   *
   * @readonly
   * @mcp-exclude Requires host credentials
   * MCP calls authenticate as a user.
   */
  async agents(): Promise<Agent[]> {
    return unwrap(await this.client.storage.listHarnessAgents()).map((a) =>
      Agent.byId(this.client, a.bot_id),
    );
  }

  /**
   * Session handles for the currently authenticated host.
   *
   * @readonly
   * @mcp-exclude Requires host credentials
   * MCP calls authenticate as a user.
   */
  async sessions(): Promise<AgentSession[]> {
    return unwrap(await this.client.storage.listHarnessSessions()).map((s) =>
      AgentSession.byId(this.client, s.session_id),
    );
  }

  /**
   * Construct a lazy pairing from its displayed code.
   *
   * @readonly
   */
  pairing(code: string): HarnessPairing {
    return HarnessPairing.byId(this.client, code);
  }

  /**
   * Start pairing a device; persist the secret separately from the handles.
   *
   * @write
   * @mcp-exclude Device-side pairing step
   * returns a device secret meant for the host process.
   */
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
