import type {
  ChannelLabel,
  ChannelLabelRule,
  SmartTagPreview,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Channel } from './channel';

export type { ChannelLabel, ChannelLabelRule, SmartTagPreview };

/**
 * Shared or private channel labels: named groups of channels shown in the Chat
 * sidebar. Every member of the team sees the same labels in the same order,
 * and any member may create, rename, delete, or move channels between them;
 * each change applies to the whole team. Users without a team have private
 * labels belonging to their account.
 *
 * A label's `channelIds` lists only the channels the authenticated user is a
 * member of. Manual labels count all assignments; smart tags count visible
 * matches. A channel can be in one manual label and any number of matching
 * smart tags per team or account. Direct messages cannot be grouped.
 */
export class ChannelLabelsNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Every label in the authenticated user's shared or private scope. */
  async list(): Promise<ChannelLabel[]> {
    const { labels } = unwrap(await this.client.storage.listChannelLabels());
    return labels;
  }

  /**
   * Create a label and atomically move `channels` into it. Names are unique
   * within the team or account, case-insensitively.
   */
  async create(name: string, channels: Channel[] = []): Promise<ChannelLabel> {
    return unwrap(
      await this.client.storage.createChannelLabel({
        body: { name, channelIds: channels.map((channel) => channel.id) },
      })
    );
  }

  /** Create a smart tag whose membership follows an attribute rule automatically. */
  async createSmartTag(
    name: string,
    rule: ChannelLabelRule
  ): Promise<ChannelLabel> {
    return unwrap(
      await this.client.storage.createChannelLabel({ body: { name, rule } })
    );
  }

  /** Preview the first matches and total visible count without creating a tag. */
  async previewSmartTag(rule: ChannelLabelRule): Promise<SmartTagPreview> {
    return unwrap(await this.client.storage.previewSmartTag({ body: rule }));
  }

  /** Update the name and matching rule of an existing smart tag. */
  async updateSmartTag(
    label: ChannelLabel,
    name: string,
    rule: ChannelLabelRule
  ): Promise<ChannelLabel> {
    return unwrap(
      await this.client.storage.renameChannelLabel({
        path: { label_id: label.id },
        body: { name, rule },
      })
    );
  }

  /** Rename a label for the whole team. */
  async rename(label: ChannelLabel, name: string): Promise<ChannelLabel> {
    return unwrap(
      await this.client.storage.renameChannelLabel({
        path: { label_id: label.id },
        body: { name },
      })
    );
  }

  /** Delete a label for the whole team; its channels return to the plain list. */
  async delete(label: ChannelLabel): Promise<void> {
    unwrap(
      await this.client.storage.deleteChannelLabel({
        path: { label_id: label.id },
      })
    );
  }

  /** Move a channel into `label`, or out of any label when `label` is `undefined`. */
  async setLabel(
    channel: Channel,
    label: ChannelLabel | undefined
  ): Promise<void> {
    unwrap(
      await this.client.storage.setChannelLabel({
        path: { channel_id: channel.id },
        body: { labelId: label?.id ?? null },
      })
    );
  }
}
