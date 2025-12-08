import type { BlockOrchestrator } from '@core/orchestrator';
import type { NotificationSource } from '@notifications';
import { createContext, type ParentProps, useContext } from 'solid-js';

export interface GlobalAppState {
  notificationSource: NotificationSource;
  blockOrchestrator: BlockOrchestrator;
}

export const GlobalAppStateContext = createContext<GlobalAppState>();

function tryGetContext(): GlobalAppState {
  const context = useContext(GlobalAppStateContext);
  if (!context) {
    throw new Error(
      `GlobalAppStateContext is not found. Make sure you're calling it within a GlobalAppStateProvider.`
    );
  }

  return context;
}

export function useGlobalAppStateContext(): GlobalAppState {
  return tryGetContext();
}

export function useGlobalNotificationSource(): NotificationSource {
  return tryGetContext().notificationSource;
}

export function useGlobalBlockOrchestrator(): BlockOrchestrator {
  return tryGetContext().blockOrchestrator;
}

export type GlobalAppStateProps = {
  notificationSource: NotificationSource;
  blockOrchestrator: BlockOrchestrator;
};

export function GlobalAppStateProvider(
  props: GlobalAppStateProps & ParentProps
) {
  return (
    <GlobalAppStateContext.Provider
      value={{
        notificationSource: props.notificationSource,
        blockOrchestrator: props.blockOrchestrator,
      }}
    >
      {props.children}
    </GlobalAppStateContext.Provider>
  );
}
