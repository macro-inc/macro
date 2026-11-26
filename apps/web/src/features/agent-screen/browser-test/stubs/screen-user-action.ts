// The agent's computer, without the harnesses query.
export * from '../../screen-user-action';

export function useAgentScreenHarnessId(userId: () => string | undefined) {
  return () => (userId() ? 'harness-1' : undefined);
}

/** Records what was opened on `window.openedScreens`, for the chat fixture. */
export function useOpenAgentScreen() {
  return (harnessId: string) => {
    const opened = (window as { openedScreens?: string[] }).openedScreens;
    (window as { openedScreens?: string[] }).openedScreens = [
      ...(opened ?? []),
      harnessId,
    ];
  };
}
