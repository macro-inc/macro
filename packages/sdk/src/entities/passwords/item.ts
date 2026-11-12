import { v7 as uuidv7 } from 'uuid';
import type {
  PasswordAgentAccessRequestState,
  PasswordAgentItemAccess,
  PasswordAgentSearchHit,
  PasswordAgentSecretPatch,
  PasswordAgentSecretSelector,
  PasswordItemKind,
  PasswordPermission,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Team } from '../teams/team';

/**
 * The one agent wake (a single agent query) a vault call is attributed to:
 * a UUIDv7 the agent's runtime mints per wake. It is untrusted correlation for
 * audit, never authorization, and is never kept across wakes.
 */
export interface AgentWake {
  /** The wake's UUIDv7. */
  wake: string;
}

/** One field of a login or API credential an agent may copy. */
export type SecretSelector = PasswordAgentSecretSelector;

/** One disclosed field, for the agent's clipboard; never for model context. */
export interface DisclosedSecret {
  /** The field's value. */
  value: string;
  /** The committed version it was read from. */
  version: number;
  /** The field that was disclosed. */
  selector: SecretSelector;
}

/** A verification code with its conservative remaining lifetime. */
export interface VerificationCode {
  /** The current code. */
  code: string;
  /** Conservative usable-until time on the server clock. */
  expiresAt: string;
  /** Code period in seconds. */
  periodSeconds: number;
  /**
   * Milliseconds the server measured until `expiresAt`. Subtract the whole
   * time since the request was sent, rounded up, before using the code.
   */
  validForMs: number;
}

/** An agent's access request on one item. */
export interface AgentAccessRequest {
  /** Request lifecycle; `none` when the agent has never requested. */
  status: PasswordAgentAccessRequestState['status'];
  /** Requested permission, when a request exists. */
  permission?: PasswordPermission;
  /** Request revision; 0 when none exists. */
  revision: number;
  /** The agent's current access to the item. */
  access: PasswordAgentItemAccess;
  /** Last transition time, when a request exists. */
  updatedAt?: string;
}

/** The wire headers of every agent vault call; mutations also carry the CSRF header. */
export function vaultHeaders(wake: AgentWake): {
  'X-Macro-Agent-Session-Id': string;
  'X-Macro-Passwords': string;
} {
  return { 'X-Macro-Agent-Session-Id': wake.wake, 'X-Macro-Passwords': '1' };
}

/**
 * A team vault item as seen by the authenticated agent, for one wake. Search
 * hits carry metadata only; values are disclosed one field at a time.
 *
 * @mcp-exclude Agent vault values must reach only the agent's secrets capability, never model context.
 */
export class PasswordItem {
  private constructor(
    private readonly client: MacroClient,
    /** The team that owns the item. */
    readonly team: Team,
    private readonly wake: AgentWake,
    /** The item's id. */
    readonly id: string,
    private hit?: PasswordAgentSearchHit,
  ) {}

  /** A handle to an item from a search hit or write result. */
  static fromHit(
    client: MacroClient,
    team: Team,
    wake: AgentWake,
    hit: PasswordAgentSearchHit,
  ): PasswordItem {
    return new PasswordItem(client, team, wake, hit.id, hit);
  }

  /** A handle to an item by id, without metadata until a write returns it. */
  static byId(
    client: MacroClient,
    team: Team,
    wake: AgentWake,
    id: string,
  ): PasswordItem {
    return new PasswordItem(client, team, wake, id);
  }

  /** Display name, when this handle came from a search or write. */
  get name(): string | undefined {
    return this.hit?.name;
  }

  /** Stored kind, when known. */
  get kind(): PasswordItemKind | undefined {
    return this.hit?.kind;
  }

  /** Website URL, when known. */
  get url(): string | undefined {
    return this.hit?.url ?? undefined;
  }

  /** Committed version, when known. */
  get version(): number | undefined {
    return this.hit?.version;
  }

  /** The agent's access when this handle was read; recomputed by every call. */
  get access(): PasswordAgentItemAccess | undefined {
    return this.hit?.access;
  }

  private path(): { team: string; item: string } {
    return { team: this.team.id, item: this.id };
  }

  /** Disclose one field for copying. Values never belong in model context. */
  async disclose(
    selector: SecretSelector,
    opts?: {
      /** Fail with `version_conflict` unless this is the committed version. */
      expectedVersion?: number;
    },
  ): Promise<DisclosedSecret> {
    return unwrap(
      await this.client.storage.passwordsAgentDisclose({
        path: this.path(),
        headers: vaultHeaders(this.wake),
        body: {
          selector,
          purpose: 'copy',
          expectedVersion: opts?.expectedVersion ?? null,
        },
      }),
    );
  }

  /** The current verification code of a login or verification-code item. */
  async verificationCode(): Promise<VerificationCode> {
    return unwrap(
      await this.client.storage.passwordsAgentTotpCode({
        path: this.path(),
        headers: vaultHeaders(this.wake),
        body: { purpose: 'copy' },
      }),
    );
  }

  /**
   * Replace supplied fields of a login or API item at `expectedVersion`.
   * Notes and custom fields are kept exactly. A retry with the same
   * `operationId` returns the accepted result.
   */
  async update(opts: {
    expectedVersion: number;
    secret?: PasswordAgentSecretPatch;
    name?: string;
    /** `null` clears the URL. */
    url?: string | null;
    /** UUIDv7 stable across retries of this update; generated when omitted. */
    operationId?: string;
  }): Promise<PasswordItem> {
    const metadata =
      opts.name === undefined && opts.url === undefined
        ? null
        : { name: opts.name ?? null, url: opts.url };
    const result = unwrap(
      await this.client.storage.passwordsAgentUpdate({
        path: this.path(),
        headers: vaultHeaders(this.wake),
        body: {
          operationId: opts.operationId ?? uuidv7(),
          expectedVersion: opts.expectedVersion,
          secretPatch: opts.secret ?? null,
          metadataPatch: metadata,
        },
      }),
    );
    this.hit = result.item;
    return this;
  }

  /** Enroll a base32 verification-code seed on a login item this agent created. */
  async setVerificationSeed(opts: {
    seed: string;
    expectedVersion: number;
    /** UUIDv7 naming this enrollment, stable across retries; generated when omitted. */
    operationId?: string;
  }): Promise<void> {
    unwrap(
      await this.client.storage.passwordsAgentSetTotp({
        path: this.path(),
        headers: vaultHeaders(this.wake),
        body: {
          operationId: opts.operationId ?? uuidv7(),
          expectedVersion: opts.expectedVersion,
          seed: opts.seed,
        },
      }),
    );
  }

  /** Ask the item's managers for access; deduplicated while pending. */
  async requestAccess(
    permission: PasswordPermission,
  ): Promise<AgentAccessRequest> {
    return toRequest(
      unwrap(
        await this.client.storage.passwordsAgentRequestAccess({
          path: this.path(),
          headers: vaultHeaders(this.wake),
          body: { permission },
        }),
      ),
    );
  }

  /** This agent's own request state for the item. */
  async accessRequest(): Promise<AgentAccessRequest> {
    return toRequest(
      unwrap(
        await this.client.storage.passwordsAgentMyRequest({
          path: this.path(),
          headers: { 'X-Macro-Agent-Session-Id': this.wake.wake },
        }),
      ),
    );
  }
}

function toRequest(state: PasswordAgentAccessRequestState): AgentAccessRequest {
  return {
    status: state.status,
    permission: state.permission ?? undefined,
    revision: state.revision,
    access: state.access,
    updatedAt: state.updatedAt ?? undefined,
  };
}
