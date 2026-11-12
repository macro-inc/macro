import type {
  EditCallTranscriptRequest,
  GetCallRecordResponses,
  LiveCallSummary,
  RingStatus,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { Thread } from '../channels/thread';
import { FavoritableEntity } from '../entity';
import { Meeting } from '../meetings/meeting';
import {
  MessageThread,
  type TimelineOptions,
  timeline,
} from '../messages/thread';
import { entitySearch } from '../search/options';
import { EntityAccess } from '../sharing/access';
import {
  type SharePermissionOptions,
  sharePermissionBody,
} from '../sharing/permissions';
import { User } from '../users/user';
import { CallConnection, type JoinOptions } from './connection';
import { callAdmissionError } from './errors';
import { CallMessage } from './message';
import { CallParticipant } from './participant';

type CallRecordDetail = GetCallRecordResponses[200];

/** A Macro call record (an archived or still active call). */
export class CallRecord extends FavoritableEntity<CallRecordDetail> {
  /** Kind is available immediately on handles returned by the live list. */
  readonly kind?: LiveCallSummary['kind'];

  private constructor(
    client: MacroClient,
    id: string,
    kind?: LiveCallSummary['kind'],
  ) {
    super(client, id);
    this.kind = kind;
  }

  /** Build a live call handle without fetching its archived detail. */
  static fromLive(client: MacroClient, summary: LiveCallSummary): CallRecord {
    return new CallRecord(client, summary.callId, summary.kind);
  }

  /**
   * Join only while this call is live; never start a replacement call.
   *
   * @write
   * @mcp-exclude Returns a live call room credential; MCP calls carry JSON only.
   */
  async join(opts: JoinOptions = {}): Promise<CallConnection> {
    try {
      const response = unwrap(
        await this.client.storage.joinCall({
          path: { call_id: this.id },
          body: opts,
        }),
      );
      return new CallConnection(this.client, response);
    } catch (error) {
      return callAdmissionError(error);
    }
  }

  /**
   * Read the current ring state for this account.
   *
   * @readonly
   */
  async ringState(): Promise<RingStatus> {
    return unwrap(
      await this.client.storage.getCallRingState({
        path: { call_id: this.id },
      }),
    ).status;
  }

  /**
   * Read the connected room roster without joining.
   *
   * @readonly
   */
  async participants(): Promise<CallParticipant[]> {
    const response = unwrap(
      await this.client.storage.getCallParticipants({
        path: { call_id: this.id },
      }),
    );
    return response.participants.map(
      (record) => new CallParticipant(this.client, record),
    );
  }

  /**
   * Decline this call's ring for the current account.
   *
   * @write
   * @idempotent
   */
  async decline(): Promise<void> {
    unwrap(
      await this.client.storage.declineCall({ path: { call_id: this.id } }),
    );
  }

  /**
   * Read the persistent discussion, which may be a channel thread.
   *
   * @readonly
   */
  async discussion(): Promise<MessageThread | Thread> {
    const discussion = (await this.detail.get()).discussion;
    if (discussion.kind === 'channel_thread') {
      return new Thread(this.client, discussion.channel_id, discussion.root_id);
    }
    return MessageThread.byId(
      this.client,
      { type: 'call', entity: this },
      discussion.call_id,
    );
  }

  /** Download recording bytes through the Macro host. */
  readonly recording = {
    bytes: async (): Promise<Uint8Array> => {
      const blob = unwrap(
        await this.client.storage.getCallRecording({
          path: { call_id: this.id },
          parseAs: 'blob',
        }),
      );
      return new Uint8Array(await blob.arrayBuffer());
    },
  };

  /**
   * A shared message thread scoped to this resource.
   *
   * @readonly
   */
  messageThreadById(id: string): MessageThread {
    return MessageThread.byId(this.client, { type: 'call', entity: this }, id);
  }

  /**
   * A mixed message and activity timeline page.
   *
   * @readonly
   */
  timelinePage(selection?: TimelineOptions<CallMessage>) {
    return timeline(
      this.client,
      { type: 'call', entity: this },
      (record) => CallMessage.from(this.client, this.id, record),
      selection,
    );
  }

  /** Access requests and direct user grants. */
  readonly access = new EntityAccess(this.client, 'call', this);

  /**
   * Get or create a shareable meeting for this call.
   *
   * @write
   * @idempotent
   */
  async meeting(): Promise<Meeting> {
    return Meeting.from(
      this.client,
      unwrap(
        await this.client.storage.meetingShare({ path: { call_id: this.id } }),
      ),
    );
  }

  /**
   * Update custom speaker assignments in the transcript.
   *
   * @write
   * @idempotent
   */
  async editTranscript(
    assignments: EditCallTranscriptRequest['assignments'],
  ): Promise<void> {
    await this.mutate((c) =>
      c.storage.editCallTranscript({
        path: { call_id: this.id },
        body: { assignments },
      }),
    );
  }

  /**
   * Toggle the server's share-with-team setting and return its new value.
   *
   * @write
   */
  async toggleTeamShare(): Promise<boolean> {
    return this.mutate((c) =>
      c.storage.toggleShareWithTeam({ path: { call_id: this.id } }),
    );
  }

  /** Favorites identify call records as `call`. */
  readonly entityType = 'call';

  protected async fetch(): Promise<CallRecordDetail> {
    return unwrap(
      await this.client.storage.getCallRecord({ path: { call_id: this.id } }),
    );
  }

  /**
   * The call's URL in the Macro web app; hand it to users as the link.
   *
   * @readonly
   */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/call/${this.id}`;
  }

  /** Identity, loaded detail and {@link webUrl}, so serialized handles carry their link. */
  override toJSON() {
    return { ...super.toJSON(), url: this.webUrl() };
  }

  /** A handle to a call record by id. Details load on first access. */
  static byId(client: MacroClient, id: string): CallRecord {
    return new CallRecord(client, id);
  }

  /**
   * A message in this call's persistent chat. Fields load on first access.
   *
   * @readonly
   */
  message(id: string): CallMessage {
    return CallMessage.byId(this.client, this.id, id);
  }

  /** The call's display name (user-supplied or AI-generated; unset while active). */
  readonly name = this.field('customName');

  /** The channel the call belongs to, if it is a channel call. */
  readonly channel = this.mappedField('channelId', (id) =>
    id ? Channel.byId(this.client, id) : undefined,
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

  /** Macro-account participants, both active and historic. */
  readonly historicParticipants = this.field('participants');

  /** Current and past guests; each id matches its transcript speaker id. */
  readonly guests = this.field('guests');

  /**
   * The canonical access level granted to the creator's team once the call is
   * archived, or null when it is not shared. Calls only ever grant `'view'`;
   * while the call is live this is null and {@link CallRecord.shareWithTeam}
   * carries the pending toggle.
   */
  readonly teamShareAccessLevel = this.field('teamShareAccessLevel');

  /**
   * Whether the call is shared with the creator's team: the pending toggle
   * while the call is live, the canonical grant once it is archived.
   */
  readonly shareWithTeam = this.field('shareWithTeam');

  /** URL of the call recording, once available. */
  readonly recordingUrl = this.field('recordingUrl');

  /** URL of the recording preview (thumbnail), once available. */
  readonly recordingPreviewUrl = this.field('recordingPreviewUrl');

  /** When the recording started, if it was recorded. */
  readonly recordingStartedAt = this.field('recordingStartedAt');

  /**
   * Rename the call or clear the custom name.
   *
   * @write
   * @idempotent
   */
  async rename(name: string | null): Promise<void> {
    await this.mutate((c) =>
      c.storage.editCallRecord({
        path: { call_id: this.id },
        body: { customName: name ?? '' },
      }),
    );
  }

  /**
   * Share the call with the creator's team (view access), or unshare it.
   * While the call is live this sets the pending toggle any participant with
   * edit access may change; once archived only the call's creator may change
   * it and the API answers 403 otherwise.
   *
   * @write
   * @idempotent
   */
  async setTeamShare(shared: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.editCallRecord({
        path: { call_id: this.id },
        body: {
          sharePermission: { teamShareAccessLevel: shared ? 'view' : null },
        },
      }),
    );
  }

  /**
   * Change who can open the call: the link share and its access level, and
   * channel grants. Omitted fields are left as they are; requires edit access
   * (channel membership). `teamShareAccessLevel` only accepts `view` or `null`,
   * and once the call is archived only its creator may change it.
   *
   * @write
   * @idempotent
   */
  async updateSharePermissions(options: SharePermissionOptions): Promise<void> {
    await this.mutate((c) =>
      c.storage.editCallRecord({
        path: { call_id: this.id },
        body: { sharePermission: sharePermissionBody(options) },
      }),
    );
  }

  /**
   * Delete the call record.
   *
   * @destructive
   * @idempotent
   */
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
