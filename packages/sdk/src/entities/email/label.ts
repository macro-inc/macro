import type { ApiLabel } from '../../../generated/email/types.gen';
import { MacroError, MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';

/**
 * An email label. A free-to-construct handle: there is no single-label GET,
 * so the detail record loads lazily on first field access by listing all
 * labels and finding this one (mirroring {@link Link}).
 */
export class Label extends MacroEntity<ApiLabel> {
  protected async fetch(): Promise<ApiLabel> {
    const { labels } = unwrap(await this.client.email.listLabels());
    const label = labels.find((l) => l.id === this.id);
    if (!label) throw new MacroNotFoundError(`label ${this.id} not found`);
    return label;
  }

  /** A handle to a label by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Label {
    return new Label(client, id);
  }

  /** All labels across the user's inboxes. */
  static async list(client: MacroClient): Promise<Label[]> {
    const { labels } = unwrap(await client.email.listLabels());
    return labels.map((l) => new Label(client, l.id, l));
  }

  /** Create a user label. */
  static async create(client: MacroClient, name: string): Promise<Label> {
    const { label } = unwrap(
      await client.email.createLabel({ body: { label_name: name } }),
    );
    if (!label.id) throw new MacroError('created label has no id');
    return new Label(client, label.id);
  }

  /** Delete this label. */
  async delete(): Promise<void> {
    unwrap(await this.client.email.deleteLabel({ path: { id: this.id } }));
  }

  /** The label's display name. */
  readonly name = this.field('name');

  /** The inbox (email link) this label belongs to. */
  readonly linkId = this.field('linkId');

  /** Whether this is a system label or a user-created one. */
  readonly type = this.field('type');

  /** When the label was created. */
  readonly createdAt = this.field('createdAt');

  /** Whether the label is shown in the label list. */
  readonly labelListVisibility = this.field('labelListVisibility');

  /** Whether the label is shown in the message list. */
  readonly messageListVisibility = this.field('messageListVisibility');
}
