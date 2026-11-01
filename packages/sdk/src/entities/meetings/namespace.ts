import type { CreateMeetingRequest } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Meeting } from './meeting';

/** Meeting schedules and invitation lookup. */
export class MeetingNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a handle to one of the caller's newest 100 standalone meetings. Use lookup for invitations. */
  byId(id: string): Meeting {
    return Meeting.byId(this.client, id);
  }

  /** Create a meeting. */
  async create(
    options: Omit<CreateMeetingRequest, 'preparationId'>,
  ): Promise<Meeting> {
    return Meeting.from(
      this.client,
      unwrap(await this.client.storage.meetingCreate({ body: options })),
    );
  }

  /** List the caller's newest 100 standalone meetings. */
  async list(): Promise<Meeting[]> {
    return unwrap(await this.client.storage.meetingList()).meetings.map((m) =>
      Meeting.from(this.client, m),
    );
  }

  /** List active meetings. */
  async active(): Promise<Meeting[]> {
    return unwrap(await this.client.storage.meetingListActive()).meetings.map(
      (m) => Meeting.from(this.client, m),
    );
  }

  /** Resolve a meeting's invitation token. */
  async lookup(token: string): Promise<Meeting> {
    return Meeting.from(
      this.client,
      unwrap(await this.client.storage.meetingLookup({ path: { token } })),
    );
  }
}
