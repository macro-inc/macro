// Only external services are replaced. The title menu, its split-menu renderers,
// Dropdown, and MobileDrawer remain production components.
const unavailable = (): never => {
  throw new Error(
    'External title-menu capability is unavailable in this fixture'
  );
};
const disabled = () => ({ canExecute: () => false });

export const useFeatureFlag = () => () => ({ enabled: false });
export const useItemOperations = () => ({ copyItem: unavailable });
export const useQuickAccess = () => ({ getById: () => undefined });
export const useGlobalNotificationSource = () => undefined;
export const useChangeEntityIcon = () => unavailable;
export const makeFavoriteAction = disabled;
export const makeMuteAction = disabled;
export const makeCreateReminderAction = disabled;
export const makeAddTagAction = disabled;
export const makeCopyLinkAction = () => ({
  canExecute: () => false,
  executeByBlock: unavailable,
});
export const makeCopyEntityIdAction = () => ({ executeById: unavailable });

// ShareTrigger stays real; its session, request badge, and telemetry hosts are external.
export const useIsAuthenticated = () => () => true;
export const useUserId = () => () => 'owner';
export const useAnalytics = () => ({ track: () => {} });
export const useShareRequestTrigger = (props: { open: () => void }) => ({
  ref: () => {},
  count: () => 0,
  open: props.open,
});
export const ShareRequestIcon = (props: {
  children: import('solid-js').JSX.Element;
}) => props.children;
export const useCopyLink = () => () => {};
