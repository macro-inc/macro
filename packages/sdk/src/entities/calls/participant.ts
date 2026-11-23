import type { LiveCallParticipant } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { User } from '../users/user';

/** A connected participant and their published track state. */
export class CallParticipant {
  /** RTC participant identity. */
  readonly identity: string;

  /** Display name in the room. */
  readonly displayName: string;

  /** Account, guest, or bot participant. */
  readonly kind: LiveCallParticipant['kind'];

  /** Whether this participant is a program. */
  readonly isProgram: boolean;

  /** When this RTC connection began. */
  readonly joinedAt?: string;

  /** Published tracks and mute state. */
  readonly tracks: LiveCallParticipant['tracks'];

  /** Macro account handle, when one is present. */
  readonly user?: User;

  /** Build a roster handle from a live participant record. */
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
