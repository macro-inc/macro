import type {
  ApprovePairingRequest,
  PairingDetails,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Team } from '../teams/team';
import { Harness } from './harness';

/** A short lived host pairing, addressed by its displayed code. */
export class HarnessPairing extends MacroEntity<PairingDetails> {
  /** Construct a lazy pairing from a pairing code. */
  static byId(client: MacroClient, code: string): HarnessPairing {
    return new HarnessPairing(client, code);
  }

  protected async fetch(): Promise<PairingDetails> {
    return unwrap(
      await this.client.storage.getHarnessPairing({ path: { code: this.id } }),
    );
  }

  /** Requested name. */
  readonly name = this.field('requested_name');

  /** Expiration time. */
  readonly expiresAt = this.field('expires_at');

  /** Approve this pairing. */
  async approve(options?: {
    name?: string;
    team?: Team;
    allowPermissionBypass?: boolean;
  }): Promise<Harness> {
    const body: ApprovePairingRequest = {
      name: options?.name,
      team_id: options?.team?.id,
      allow_permission_bypass: options?.allowPermissionBypass,
    };
    return Harness.from(
      this.client,
      await this.mutate((c) =>
        c.storage.approveHarnessPairing({ path: { code: this.id }, body }),
      ),
    );
  }
}

/** Device side pairing identity. Keep the device secret outside the handle. */
export class DevicePairing {
  private constructor(
    private readonly client: MacroClient,
    /** Pairing identifier. */
    readonly id: string,
  ) {}

  /** Construct the device side handle. */
  static byId(client: MacroClient, id: string): DevicePairing {
    return new DevicePairing(client, id);
  }

  /** Attempt to claim an approved pairing. Pending claims return undefined. */
  async claim(
    deviceSecret: string,
  ): Promise<{ harness: Harness; token: string } | undefined> {
    const response = unwrap(
      await this.client.storage.claimHarnessPairing({
        path: { pairing_id: this.id },
        body: { device_secret: deviceSecret },
      }),
    );
    return 'harness' in response
      ? {
          harness: Harness.from(this.client, response.harness),
          token: response.token,
        }
      : undefined;
  }

  /** Serialize identity only. */
  toJSON() {
    return { id: this.id };
  }
}
