import { type Accessor, createContext, useContext } from 'solid-js';
import type {
  CallSettings,
  RecordingKind,
  ShareAudience,
} from '../core/call-settings';

export type CallSettingsSource = {
  /** Undefined until the settings first load. */
  settings: Accessor<CallSettings | undefined>;
  error: Accessor<boolean>;
};

/**
 * Every change shows at once; a failed save reverts it and reports the error.
 */
export type CallSettingsCapabilities = {
  createSource: () => CallSettingsSource;
  /** Change whether the viewer's own calls of `kind` record by default. */
  setRecordByDefault: (kind: RecordingKind, value: boolean) => void;
  /** Change who the viewer's calls of `kind` are shared with once they end. */
  setShareByDefault: (kind: RecordingKind, audience: ShareAudience) => void;
  /** Change whether the viewer refuses being recorded in 1:1s. */
  setRefuseOneOnOneRecording: (value: boolean) => void;
  /** Change whether anyone on the viewer's team may record `kind`. */
  setRecordingBlocked: (kind: RecordingKind, blocked: boolean) => void;
  /** Change whether anyone's huddles may be shared with the viewer's team. */
  setHuddleSharingBlocked: (blocked: boolean) => void;
};

const Context = createContext<CallSettingsCapabilities>();
export const CallSettingsProvider = Context.Provider;

export function useCallSettings(): CallSettingsCapabilities {
  const context = useContext(Context);
  if (!context)
    throw new Error('Call settings views require a CallSettingsProvider');
  return context;
}
