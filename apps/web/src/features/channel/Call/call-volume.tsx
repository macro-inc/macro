import { createContext, type ParentProps, useContext } from 'solid-js';
import { createCallVolumeState } from './primitives/create-call-volume';

export { createCallVolumeState } from './primitives/create-call-volume';

const CallVolumeContext =
  createContext<ReturnType<typeof createCallVolumeState>>();
export function CallVolumeProvider(props: ParentProps) {
  const state = createCallVolumeState();
  return (
    <CallVolumeContext.Provider value={state}>
      {props.children}
    </CallVolumeContext.Provider>
  );
}
export const useCallVolumeOptional = () => useContext(CallVolumeContext);
