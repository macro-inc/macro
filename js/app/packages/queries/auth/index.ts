export { authKeys } from './keys';
export {
  useUserInfoQuery,
  invalidateUserInfo,
  invalidateAllAfterLogin,
  updateUserInfo,
  type UserInfoData,
} from './user-info';
// Re-export user context hooks for backwards compatibility
export {
  useUserId,
  useEmail,
  usePermissions,
  useAuthor,
  useLicenseStatus,
  useTutorialCompleted,
  useGroup,
  useHasChromeExt,
  useHasTrialed,
  useUserInfo,
  useIsAuthenticated,
} from '@core/context/user';
export {
  useCompleteOnboardingMutation,
  useSetGroupMutation,
} from './mutations';
export {
  useUserQuotaQuery,
  invalidateUserQuota,
  useInvalidateUserQuota,
  useUpdateUserQuotaCache,
} from './user-quota';
