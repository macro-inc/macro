import { usePreference } from '@app/preferences/use-preference';
import {
  type Accessor,
  createContext,
  type ParentProps,
  type Setter,
  useContext,
} from 'solid-js';

const VisibilityContext = createContext<[Accessor<boolean>, Setter<boolean>]>();

export function SidePanelVisibilityProvider(props: ParentProps) {
  const visibility = usePreference('macro:pref:side-panel:open', {
    default: true,
  });
  return (
    <VisibilityContext.Provider value={visibility}>
      {props.children}
    </VisibilityContext.Provider>
  );
}

export function useSidePanelVisibility() {
  const visibility = useContext(VisibilityContext);
  if (!visibility)
    throw new Error(
      'Side panel visibility requires SidePanelVisibilityProvider'
    );
  return visibility;
}
