import { createSoupState, type SoupState } from './create-soup-state';
import { createContext, type FlowComponent, useContext } from 'solid-js';

const SoupContext = createContext<SoupState>();

export const useSoup = () => {
  const context = useContext(SoupContext);

  if (!context) {
    throw new Error('useSoup can only be used under a SoupContext.Provider');
  }
  return context;
};

export const useMaybeSoup = () => useContext(SoupContext);

interface SoupContextProviderProps {
  soup?: SoupState;
}

export const SoupContextProvider: FlowComponent<SoupContextProviderProps> = (
  props
) => {
  return (
    <SoupContext.Provider value={props.soup ?? createSoupState()}>
      {props.children}
    </SoupContext.Provider>
  );
};
