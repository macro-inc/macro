import type { GetCallRecordResponses } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { FavoritableEntity } from '../entity';
import { entitySearch } from '../search';
import { User } from '../users/user';

type CallRecordDetail = GetCallRecordResponses[200];

/** A Macro call record (an archived, or still active, channel call). */
export class CallRecord extends FavoritableEntity<CallRecordDetail> {
  /** Favorites identify call records as `call`. */
  readonly entityType = 'call';

  protected async fetch(): Promise<CallRecordDetail> {
    return unwrap(
      await this.client.storage.getCallRecord({ path: { call_id: this.id } }),
    );
  }

  /** A handle to a call record by id. Details load on first access. */
  static byId(client: MacroClient, id: string): CallRecord {
    return new CallRecord(client, id);
  }

  /** The call's display name (user-supplied or AI-generated; unset while active). */
  readonly name = this.field('customName');

  /** The channel the call belongs to. */
  readonly channel = this.mappedField('channelId', (id) =>
    Channel.byId(this.client, id),
  );

  /** The display name of the channel the call belongs to. */
  readonly channelName = this.field('channelName');

  /** The user who started the call. */
  readonly creator = this.mappedField('createdBy', (id) =>
    User.byId(this.client, id),
  );

  /** Whether the call is still in progress. */
  readonly isActive = this.field('isActive');

  /** The call's status (undefined until set). */
  readonly status = this.field('status');

  /** The realtime room the call runs in. */
  readonly roomName = this.field('roomName');

  /** When the call started. */
  readonly startedAt = this.field('startedAt');

  /** When the call ended (undefined if still active). */
  readonly endedAt = this.field('endedAt');

  /** Call duration in milliseconds (undefined if still active). */
  readonly durationMs = this.field('durationMs');

  /** AI-generated summary of the call, once summarization has run. */
  readonly summary = this.field('summary');

  /** Transcript segments, ordered by sequence number. */
  readonly transcript = this.field('transcript');

  /** Participants, both active and historic. */
  readonly participants = this.field('participants');

  /** Whether the recording is shared with the team. */
  readonly shareWithTeam = this.field('shareWithTeam');

  /** URL of the call recording, once available. */
  readonly recordingUrl = this.field('recordingUrl');

  /** URL of the recording preview (thumbnail), once available. */
  readonly recordingPreviewUrl = this.field('recordingPreviewUrl');

  /** When the recording started, if it was recorded. */
  readonly recordingStartedAt = this.field('recordingStartedAt');

  /** Rename the call or clear the custom name. */
  async rename(name: string | null): Promise<void> {
    await this.mutate((c) =>
      c.storage.editCallRecord({
        path: { call_id: this.id },
        body: { customName: name ?? '' },
      }),
    );
  }

  /** Delete the call record. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteCallRecord({ path: { call_id: this.id } }),
    );
  }

  /** Search calls by name and transcript, most relevant first, auto-paginated. */
  static search = entitySearch({
    filters: { call_filters: {} },
    type: 'call',
    make: (client, hit) => new CallRecord(client, hit.call_id),
  });
}
