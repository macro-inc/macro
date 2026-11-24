/**
 * Where a ringing channel call is: a conversation that is the recipient's own
 * (a DM or group chat, "Calling you") or a named channel.
 */
export type IncomingCallPlace =
  | { kind: 'direct' }
  | { kind: 'channel'; name: string };

/** A ringing channel or DM call, resolved for display. */
export type IncomingChannelCall = {
  callId: string;
  channelId: string;
  callerId: string | null;
  /** Empty while the caller's name is unknown. */
  callerName: string;
  place: IncomingCallPlace;
  expiresAt: string;
};
