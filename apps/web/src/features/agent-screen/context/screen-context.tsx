import type { Span } from '@macro-inc/observability';
import type { Result } from 'neverthrow';
import { createContext, type JSX, useContext } from 'solid-js';
import type { TicketFailure } from '../core/screen-status';
import type {
  ScreenMode,
  ScreenTicketGrant,
  ScreenTransport,
  ScreenTransportKind,
} from '../transports/types';

export type ScreenTicketRequest = {
  harnessId: string;
  transport: ScreenTransportKind;
  /** The viewer shows the desktop; the harness's ticket API names it. */
  surface: 'desktop';
  mode: ScreenMode;
};

/**
 * What the screen viewer needs from the app: tickets from the harness and the
 * transports that redeem them. The route entry supplies the real ones; tests
 * supply fakes.
 */
export type ScreenCapabilities = {
  requestTicket: (
    request: ScreenTicketRequest,
    span: Span
  ) => Promise<Result<ScreenTicketGrant, TicketFailure>>;
  transport: (kind: ScreenTransportKind) => ScreenTransport;
};

const ScreenCapabilitiesContext = createContext<ScreenCapabilities>();

export function ScreenCapabilitiesProvider(props: {
  value: ScreenCapabilities;
  children: JSX.Element;
}) {
  return (
    <ScreenCapabilitiesContext.Provider value={props.value}>
      {props.children}
    </ScreenCapabilitiesContext.Provider>
  );
}

export function useScreenCapabilities(): ScreenCapabilities {
  const capabilities = useContext(ScreenCapabilitiesContext);
  if (!capabilities) {
    throw new Error('useScreenCapabilities needs a ScreenCapabilitiesProvider');
  }
  return capabilities;
}
