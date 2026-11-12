import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import type { SearchOpts } from '../search/options';
import { CallRecord } from './call-record';

/** A lightweight preview of an existing call record. */
export type CallSummary = {
  call: CallRecord;
  channel?: Channel;
  channelName?: string;
  customName?: string;
  startedAt: string;
  endedAt?: string;
};

/**
 * @routing Use when finding live or recorded calls, entering a room, reading a transcript, or downloading a recording; not email, messages, tables or scheduling.
 * @agent A program uses an agent account's own API key to enter a call. Use active() to reconcile missed events. Join an existing call with call.join(); start a channel call only when intending to ring its members. Calls with only programs end after the server timeout. Keep room tokens private and connect with a LiveKit client outside code mode.
 */
export class CallRecordNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Get a lazy call handle; joining it never creates a call. */
  byId(id: string): CallRecord {
    return CallRecord.byId(this.client, id);
  }

  /**
   * Search archived calls by name and transcript, not the live room roster.
   *
   * @readonly
   */
  search(query: string, opts?: SearchOpts): AsyncGenerator<CallRecord> {
    return CallRecord.search(this.client, query, opts);
  }

  /**
   * List joinable live calls; use after an event stream reconnects.
   *
   * @readonly
   */
  async active(): Promise<CallRecord[]> {
    const response = unwrap(await this.client.storage.getLiveCalls());
    return response.calls.map((summary) =>
      CallRecord.fromLive(this.client, summary),
    );
  }

  /**
   * Preview these calls in input order; missing records are omitted.
   *
   * @readonly
   */
  async summaries(calls: CallRecord[]): Promise<CallSummary[]> {
    if (calls.length === 0) return [];

    const { previews } = unwrap(
      await this.client.storage.getBatchCallRecordPreview({
        body: { callIds: calls.map((call) => call.id) },
      }),
    );
    const found = new Map(
      previews.flatMap((preview) =>
        preview.type === 'exists' ? [[preview.callId, preview]] : [],
      ),
    );
    return calls.flatMap((call) => {
      const preview = found.get(call.id);
      if (!preview) return [];
      return [
        {
          call,
          channel: preview.channelId
            ? Channel.byId(this.client, preview.channelId)
            : undefined,
          channelName: preview.channelName ?? undefined,
          customName: preview.customName ?? undefined,
          startedAt: preview.startedAt,
          endedAt: preview.endedAt ?? undefined,
        },
      ];
    });
  }
}
