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
  /** The call this credential enters. */
  readonly call: CallRecord;

  /** LiveKit server URL. */
  readonly url: string;

  /** Short-lived LiveKit token; never serialize or log it. */
  readonly token: string;

  /** RTC participant identity. */
  readonly identity: string;

  /** RTC room name. */
  readonly roomName: string;

  /** Whether this request created the call. */
  readonly started: boolean;

  /** Construct a connection from the server's admission response. */
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

  /**
   * Leave this exact call; safe to invoke after another call has started.
   *
   * @write
   * @idempotent
   * @mcp-exclude Acts on a live call connection, which only a join returns.
   */
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
