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
