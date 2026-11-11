import type {
  Meeting as MeetingRecord,
  UpdateMeetingRequest,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { CallRecord } from '../calls/call-record';
import { CallConnection, type JoinOptions } from '../calls/connection';
import { callAdmissionError } from '../calls/errors';
import { Channel } from '../channels/channel';
import { MacroEntity } from '../entity';
import type { User } from '../users/user';

/** A meeting's schedule and invitation link. */
export class Meeting extends MacroEntity<MeetingRecord> {
  /**
   * Join this meeting as the current account; always send a program join body.
   *
   * @write
   * @mcp-exclude Returns a live call connection; MCP calls carry JSON only.
   */
  async join(opts: JoinOptions = {}): Promise<CallConnection> {
    try {
      const response = unwrap(
        await this.client.storage.meetingJoin({
          path: { token: (await this.detail.get()).shareToken },
          body: opts,
        }),
      );
      return new CallConnection(this.client, response);
    } catch (error) {
      return callAdmissionError(error);
    }
  }

  /**
   * Join the link as a named guest.
   *
   * @write
   * @mcp-exclude Returns a live call connection; MCP calls carry JSON only.
   */
  async joinAsGuest(name: string): Promise<CallConnection> {
    const response = unwrap(
      await this.client.storage.meetingGuestJoin({
        path: { token: (await this.detail.get()).shareToken },
        body: { displayName: name },
      }),
    );
    return new CallConnection(this.client, response);
  }

  private lookupToken?: string;

  private constructor(client: MacroClient, id: string, record?: MeetingRecord) {
    super(client, id, record);
    this.lookupToken = record?.shareToken;
  }

  /** Construct a lazy meeting handle. */
  static byId(client: MacroClient, id: string): Meeting {
    return new Meeting(client, id);
  }

  /** Seed a meeting from a server response. */
  static from(client: MacroClient, record: MeetingRecord): Meeting {
    return new Meeting(client, record.id, record);
  }

  protected async fetch(): Promise<MeetingRecord> {
    if (this.lookupToken)
      return unwrap(
        await this.client.storage.meetingLookup({
          path: { token: this.lookupToken },
        }),
      );

    const record = unwrap(
      await this.client.storage.meetingList(),
    ).meetings.find((m) => m.id === this.id);
    if (!record)
      throw new MacroNotFoundError(`Meeting ${this.id} is unavailable`);
    this.lookupToken = record.shareToken;
    return record;
  }

  /** Display title. */
  readonly title = this.field('title');

  /** Scheduled start. */
  readonly scheduledStart = this.field('scheduledStart');

  /** Scheduled end. */
  readonly scheduledEnd = this.field('scheduledEnd');

  /** Associated channel. */
  readonly channel = this.mappedField('channelId', (id) =>
    id ? Channel.byId(this.client, id) : undefined,
  );

  /** Associated call record. */
  readonly call = this.mappedField('callId', (id) =>
    id ? CallRecord.byId(this.client, id) : undefined,
  );

  /**
   * Update schedule or title.
   *
   * @write
   * @idempotent
   */
  async update(options: UpdateMeetingRequest): Promise<void> {
    await this.mutate((c) =>
      c.storage.meetingUpdate({ path: { meeting_id: this.id }, body: options }),
    );
  }

  /**
   * Cancel this meeting.
   *
   * @destructive
   * @idempotent
   */
  async cancel(): Promise<void> {
    await this.mutate((c) =>
      c.storage.meetingCancel({ path: { meeting_id: this.id } }),
    );
  }

  /**
   * Whether the caller can send invitations.
   *
   * @readonly
   */
  async invitePermissions() {
    return unwrap(
      await this.client.storage.meetingInvitePermissions({
        path: { token: (await this.detail.get()).shareToken },
      }),
    );
  }

  /**
   * Invite an email address.
   *
   * @destructive
   * @openworld
   */
  async invite(email: string): Promise<void> {
    unwrap(
      await this.client.storage.meetingInvite({
        path: { token: (await this.detail.get()).shareToken },
        body: { email },
      }),
    );
  }

  /**
   * Invite Macro users.
   *
   * @write
   */
  async inviteUsers(users: User[]): Promise<void> {
    unwrap(
      await this.client.storage.meetingInviteUsers({
        path: { token: (await this.detail.get()).shareToken },
        body: { userIds: users.map((u) => u.id) },
      }),
    );
  }

  /**
   * Shareable meeting link.
   *
   * @readonly
   */
  async webUrl(): Promise<string> {
    return `${this.client.webAppUrl}/app/meet/join/${encodeURIComponent((await this.detail.get()).shareToken)}`;
  }
}
