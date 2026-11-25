// No call in the DM, without the call provider.
export * from '../../../channel/Call/use-call';

export function useCall() {
  return {
    joinCall: () => {},
    startCall: () => {},
    leaveCall: () => {},
    isJoining: () => false,
    isLeaving: () => false,
    isInCall: () => false,
    isInThisChannel: () => false,
    joinError: () => null,
  };
}
