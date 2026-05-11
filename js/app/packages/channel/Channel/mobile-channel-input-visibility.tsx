import { isMobile } from '@core/mobile/isMobile';
import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  useContext,
} from 'solid-js';

type MobileChannelInputVisibilityState = {
  isHidden: Accessor<boolean>;
  hide: () => void;
  show: () => void;
};

const MobileChannelInputVisibilityContext =
  createContext<MobileChannelInputVisibilityState>();

/**
 * On mobile: creates reactive hide/show state and provides it via context.
 * On desktop: renders children as-is with no context or signals.
 */
export function MaybeMobileChannelInputVisibilityProvider(props: {
  children: JSX.Element;
}) {
  if (!isMobile()) return props.children;
  const [isHidden, setIsHidden] = createSignal(false);
  return (
    <MobileChannelInputVisibilityContext.Provider
      value={{
        isHidden,
        hide: () => setIsHidden(true),
        show: () => setIsHidden(false),
      }}
    >
      {props.children}
    </MobileChannelInputVisibilityContext.Provider>
  );
}

export function useMobileChannelInputVisibility():
  | MobileChannelInputVisibilityState
  | undefined {
  return useContext(MobileChannelInputVisibilityContext);
}
