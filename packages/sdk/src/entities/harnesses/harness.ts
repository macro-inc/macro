import type { Harness as HarnessRecord } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';

/** A registered host for coding agents. */
export class Harness extends MacroEntity<HarnessRecord> {
  /** Construct a lazy host handle. */
  static byId(client: MacroClient, id: string): Harness {
    return new Harness(client, id);
  }

  /** Seed from a listed host. */
  static from(client: MacroClient, record: HarnessRecord): Harness {
    return new Harness(client, record.id, record);
  }

  protected async fetch(): Promise<HarnessRecord> {
    const record = unwrap(await this.client.storage.listHarnesses()).find(
      (h) => h.id === this.id,
    );
    if (!record)
      throw new MacroNotFoundError(`Harness ${this.id} is unavailable`);
    return record;
  }

  /** Display name. */
  readonly name = this.field('name');

  /** Whether the host is connected. */
  readonly connected = this.field('connected');

  /** Runtime kind. */
  readonly kind = this.field('kind');

  /**
   * Whether the owner lets agents here bypass permission prompts. Takes effect
   * only while the machine's operator allows it too.
   */
  readonly allowPermissionBypass = this.field('allow_permission_bypass');

  /**
   * The machine operator's consent to permission bypass, as the host last
   * reported it; `undefined` until a host reports it.
   */
  readonly operatorAllowsBypass = this.field('operator_allows_bypass');

  /**
   * Allow or forbid agents here to bypass permission prompts. Allowing
   * requires the machine operator's reported consent.
   */
  async setPermissionBypass(allowed: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchHarness({
        path: { harness_id: this.id },
        body: { allow_permission_bypass: allowed },
      }),
    );
  }

  /** Remove the host. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteHarness({ path: { harness_id: this.id } }),
    );
  }
}
