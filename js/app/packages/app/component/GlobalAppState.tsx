import type { BlockOrchestrator } from '@core/orchestrator';
import type { EmailSource } from '@macro-entity';
import type { NotificationSource } from '@notifications/notification-source';
import { createContext, type ParentProps, useContext } from 'solid-js';

export interface GlobalAppState {
  notificationSource: NotificationSource;
  emailSource: EmailSource;
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

export function useGlobalEmailSource(): EmailSource {
  return tryGetContext().emailSource;
}

export function useGlobalBlockOrchestrator(): BlockOrchestrator {
  return tryGetContext().blockOrchestrator;
}

export type GlobalAppStateProps = {
  notificationSource: NotificationSource;
  emailSource: EmailSource;
  blockOrchestrator: BlockOrchestrator;
};

export function GlobalAppStateProvider(
  props: GlobalAppStateProps & ParentProps
) {
  return (
    <GlobalAppStateContext.Provider
      value={{
        notificationSource: props.notificationSource,
        emailSource: props.emailSource,
        blockOrchestrator: props.blockOrchestrator,
      }}
    >
      {props.children}
    </GlobalAppStateContext.Provider>
  );
}
