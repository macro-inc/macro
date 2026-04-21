import type { RemoteParticipant } from 'livekit-client';
import type { Accessor } from 'solid-js';
import type { CallState } from '../CallContext';

export type InCallPanelMember =
  | { kind: 'local' }
  | { kind: 'remote'; participant: RemoteParticipant };

export type InCallVisibleAvatarSlot =
  | { type: 'member'; member: InCallPanelMember; key: string }
  | { type: 'placeholder'; key: string };

export type InCallPanelControls = {
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  leaveCall: () => Promise<void>;
  switchAudioInput: CallState['switchAudioInput'];
  switchAudioOutput: CallState['switchAudioOutput'];
  switchVideoInput: CallState['switchVideoInput'];
};

export type UseInCallPanelOptions = {
  /**
   * When set, `isActive` is true only if the active call is for this channel.
   * Omit to treat any active call as active (sidebar-global).
   */
  channelId?: Accessor<string | undefined>;
  /** Same role as `useCall` `onLeave` (e.g. switch tab back to Messages). */
  onLeaveCall?: () => void;
  onJoinCall?: () => void;
};

export type UseInCallPanelResult = {
  /** Whether the panel should render (in a call, and optional channel filter). */
  isActive: () => boolean;
  /** Members shown as inline avatars. */
  visibleMembers: Accessor<InCallPanelMember[]>;
  /** One placeholder while connecting; otherwise up to visible cap members (no padding). */
  visibleAvatarSlots: Accessor<InCallVisibleAvatarSlot[]>;
  /** Members listed in the overflow dropdown. */
  overflowMembers: Accessor<InCallPanelMember[]>;
  isConnecting: CallState['isConnecting'];
  /** LiveKit + device state (read in your DOM). */
  callCtx: CallState;
  /** Join / leave orchestration for this channel. */
  controls: InCallPanelControls;
};

export type InCallPanelProps = {
  /** Plain boolean or accessor so sidebar width updates stay tracked in Solid. */
  isSlim: boolean | Accessor<boolean>;
  channelId?: Accessor<string | undefined>;
  onLeaveCall?: () => void;
  onJoinCall?: () => void;
  class?: string;
  /**
   * When false, the in-panel mic / camera / screen / leave row is hidden.
   * Omitted defaults to visible. Use an accessor to toggle reactively.
   */
  showCallControls?: boolean | Accessor<boolean>;
};
