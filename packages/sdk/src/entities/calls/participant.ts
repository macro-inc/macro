import type { LiveCallParticipant } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { User } from '../users/user';

/** A connected participant and their published track state. */
export class CallParticipant {
  readonly identity: string;
  readonly displayName: string;
  readonly kind: LiveCallParticipant['kind'];
  readonly isProgram: boolean;
  readonly joinedAt?: string;
  readonly tracks: LiveCallParticipant['tracks'];
  readonly user?: User;

  constructor(client: MacroClient, record: LiveCallParticipant) {
    this.identity = record.identity;
    this.displayName = record.displayName;
    this.kind = record.kind;
    this.isProgram = record.isProgram;
    this.joinedAt = record.joinedAt ?? undefined;
    this.tracks = record.tracks;
    this.user = record.userId ? User.byId(client, record.userId) : undefined;
  }
}
