import type { ChannelTopic } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** Team topics visible to the authenticated user. Channel IDs are participant-scoped. */
export class ChannelTopics {
  constructor(private readonly client: MacroClient) {}

  /** List the caller's team topics. */
  async list(): Promise<ChannelTopic[]> {
    return unwrap(await this.client.storage.listChannelTopics()).topics;
  }

  /** Create a team topic. */
  async create(name: string, description?: string): Promise<string> {
    return unwrap(
      await this.client.storage.createChannelTopic({
        body: { name, description: description ?? null },
      })
    ).id;
  }

  /** Rename or describe a topic. */
  async update(
    id: string,
    fields: { name?: string; description?: string }
  ): Promise<void> {
    unwrap(
      await this.client.storage.updateChannelTopic({
        path: { id },
        body: {
          name: fields.name ?? null,
          description: fields.description ?? null,
        },
      })
    );
  }

  /** Delete a topic. Its channels remain intact. */
  async delete(id: string): Promise<void> {
    unwrap(await this.client.storage.deleteChannelTopic({ path: { id } }));
  }

  /** File a team channel under a topic. */
  async addChannel(topicId: string, channelId: string): Promise<void> {
    unwrap(
      await this.client.storage.addChannelToTopic({
        path: { id: topicId, channel_id: channelId },
      })
    );
  }

  /** Remove a channel from a topic. */
  async removeChannel(topicId: string, channelId: string): Promise<void> {
    unwrap(
      await this.client.storage.removeChannelFromTopic({
        path: { id: topicId, channel_id: channelId },
      })
    );
  }

  /** Persist this user's custom topic order. */
  async setOrder(topicIds: string[]): Promise<void> {
    unwrap(
      await this.client.storage.setChannelTopicOrder({
        body: { topic_ids: topicIds },
      })
    );
  }
}
