import { type Accessor, createContext, useContext } from 'solid-js';
import type { AgentsMode } from '../core/mode';

/**
 * The design's `data-mode` vocabulary: `macro` is Chat, `work` is Code. The
 * stylesheet keys its per-mode rules on it, and dialogs rendered through a
 * portal read it here so they can carry the same attribute.
 */
export type DataMode = 'macro' | 'work';

export function dataModeFor(mode: AgentsMode): DataMode {
  return mode === 'code' ? 'work' : 'macro';
}

const defaultMode: Accessor<DataMode> = () => 'macro';
const DataModeContext = createContext(defaultMode);

export const DataModeProvider = DataModeContext.Provider;

export function useDataMode(): Accessor<DataMode> {
  return useContext(DataModeContext);
}
