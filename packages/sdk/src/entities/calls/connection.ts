import type {
  CallTokenResponse,
  JoinCallRequest,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { CallRecord } from './call-record';

const inspectSymbol: unique symbol = Symbol.for('nodejs.util.inspect.custom');

/** Options for entering a call. The default is to fail if already in another call. */
export type JoinOptions = JoinCallRequest;

/** A room credential. Keep `token` out of logs and serialized values. */
export class CallConnection {
  readonly call: CallRecord;
  readonly url: string;
  readonly token: string;
  readonly identity: string;
  readonly roomName: string;
  readonly started: boolean;

  constructor(
    private readonly client: MacroClient,
    response: CallTokenResponse,
  ) {
    this.call = CallRecord.byId(client, response.callId);
    this.url = response.serverUrl;
    this.token = response.token;
    this.identity = response.participantId;
    this.roomName = response.roomName;
    this.started = response.started;
  }

  /** Leave this exact call; safe to invoke after another call has started. */
  async leave(): Promise<{ callEnded: boolean }> {
    return unwrap(
      await this.client.storage.leaveCall({ path: { call_id: this.call.id } }),
    );
  }

  /** Serialize connection metadata without the room credential. */
  toJSON() {
    return {
      call: this.call.toJSON(),
      url: this.url,
      identity: this.identity,
      roomName: this.roomName,
      started: this.started,
    };
  }

  /** Keep the credential out of Node's console inspection. */
  [inspectSymbol]() {
    return this.toJSON();
  }
}
