import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { Person } from './people';

export type SentMessage = { id: string; content: string };

type NewChannel = {
  /** Left out, the channel gets a name no other test uses. */
  name?: string;
  type?: 'private' | 'public' | 'team' | 'direct_message';
  members?: Person[];
  teamId?: string;
};

/** For a call whose answer is not read: services answer some in plain text. */
async function done(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed (${response.status()}): ${await response.text()}`
    );
  }
}

async function answered<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed (${response.status()}): ${await response.text()}`
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A name no other test or run uses, so a row can be found by it. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * What one person does through the services, with their own session. Tests
 * use it to set a scene and to act as the other person; what a test is
 * about is done in the browser.
 */
export class Api {
  constructor(
    readonly person: Person,
    private readonly http: APIRequestContext
  ) {}

  async createChannel(options: NewChannel = {}): Promise<{
    id: string;
    name: string;
  }> {
    const name = options.name ?? unique('e2e');
    const type = options.type ?? 'private';
    const made = await answered<{ id: string }>(
      await this.http.post('/dss/channels', {
        data: {
          channel_type: type,
          name: type === 'direct_message' ? undefined : name,
          participants: (options.members ?? []).map((member) => member.userId),
          team_id: options.teamId,
        },
      }),
      'create channel'
    );
    return { id: made.id, name };
  }

  async post(
    channelId: string,
    content: string,
    options: { threadId?: string } = {}
  ): Promise<SentMessage> {
    return answered<SentMessage>(
      await this.http.post(`/dss/messages/channel/${channelId}`, {
        data: { content, thread_id: options.threadId },
      }),
      'post message'
    );
  }

  /** Posts the texts one after another, so they are stored in that order. */
  async postAll(channelId: string, texts: string[]): Promise<SentMessage[]> {
    const sent: SentMessage[] = [];
    for (const text of texts) {
      sent.push(await this.post(channelId, text));
    }
    return sent;
  }

  async edit(channelId: string, id: string, content: string): Promise<void> {
    await done(
      await this.http.patch(`/dss/messages/channel/${channelId}/items/${id}`, {
        data: { content },
      }),
      'edit message'
    );
  }

  async remove(channelId: string, id: string): Promise<void> {
    await done(
      await this.http.delete(`/dss/messages/channel/${channelId}/items/${id}`),
      'delete message'
    );
  }

  async react(
    channelId: string,
    id: string,
    emoji: string,
    add = true
  ): Promise<void> {
    await done(
      await this.http.post(
        `/dss/messages/channel/${channelId}/items/${id}/reactions`,
        { data: { emoji, add } }
      ),
      'react'
    );
  }

  async typing(channelId: string, active = true): Promise<void> {
    await done(
      await this.http.post(`/dss/messages/channel/${channelId}/typing`, {
        data: { thread_id: null, active },
      }),
      'typing'
    );
  }

  async rename(channelId: string, name: string): Promise<void> {
    await done(
      await this.http.patch(`/dss/channels/${channelId}`, {
        data: { channel_name: name },
      }),
      'rename channel'
    );
  }

  async addParticipants(channelId: string, people: Person[]): Promise<void> {
    await done(
      await this.http.post(`/dss/channels/${channelId}/participants`, {
        data: { participants: people.map((person) => person.userId) },
      }),
      'add participants'
    );
  }

  async removeParticipants(channelId: string, people: Person[]): Promise<void> {
    await done(
      await this.http.delete(`/dss/channels/${channelId}/participants`, {
        data: { participants: people.map((person) => person.userId) },
      }),
      'remove participants'
    );
  }

  /** The texts the service holds for the channel's latest page, oldest first. */
  async latestTexts(channelId: string, limit = 50): Promise<string[]> {
    const selection = JSON.stringify({ limit, direction: 'older' });
    const page = await answered<{
      entries: { type: string; message?: { content: string } }[];
    }>(
      await this.http.get(
        `/dss/messages/channel/${channelId}/timeline?selection=${encodeURIComponent(selection)}`
      ),
      'read timeline'
    );
    return page.entries
      .filter((entry) => entry.type === 'message')
      .map((entry) => entry.message?.content ?? '');
  }
}
