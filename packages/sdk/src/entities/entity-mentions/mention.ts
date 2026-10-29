import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** A stored mention connecting two resources. */
export class EntityMention {
  private constructor(
    private readonly client: MacroClient,
    /** Mention identity. */
    readonly id: string,
  ) {}

  /** Construct a mention handle for removal. */
  static byId(client: MacroClient, id: string): EntityMention {
    return new EntityMention(client, id);
  }

  /** Remove this mention. */
  async delete(): Promise<void> {
    unwrap(
      await this.client.storage.deleteEntityMention({
        path: { mention_id: this.id },
      }),
    );
  }

  /** Serialize identity only. */
  toJSON() {
    return { id: this.id };
  }
}
