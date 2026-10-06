import { type Accessor, createContext, useContext } from 'solid-js';
import type { RecordingKind, RecordingSettings } from '../core/recording-kinds';

export type CallSettingsSource = {
  /** Undefined until the settings first load. */
  settings: Accessor<RecordingSettings | undefined>;
  error: Accessor<boolean>;
};

export type CallSettingsCapabilities = {
  createSource: () => CallSettingsSource;
  /**
   * Change whether the viewer's own calls of `kind` record by default. The
   * change shows at once; a failed save reverts it and reports the error.
   */
  setRecordByDefault: (kind: RecordingKind, value: boolean) => void;
  /** Change whether anyone on the viewer's team may record `kind`. */
  setTeamBlock: (kind: RecordingKind, blocked: boolean) => void;
};

const Context = createContext<CallSettingsCapabilities>();
export const CallSettingsProvider = Context.Provider;

export function useCallSettings(): CallSettingsCapabilities {
  const context = useContext(Context);
  if (!context)
    throw new Error('Call settings views require a CallSettingsProvider');
  return context;
}
