/** Where a ringing channel call is: the recipient's DM, a channel, or a group chat. */
export type IncomingCallPlace =
  | { kind: 'direct' }
  | { kind: 'channel'; name: string }
  | { kind: 'group'; name: string };

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
