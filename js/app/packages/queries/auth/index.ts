// Re-export user context hooks for backwards compatibility
export {
  useAuthor,
  useEmail,
  useGroup,
  useHasChromeExt,
  useHasTrialed,
  useIsAuthenticated,
  useLicenseStatus,
  usePermissions,
  useTutorialCompleted,
  useUserId,
  useUserInfo,
} from '@core/context/user';
export { authKeys } from './keys';
export { useSendMobileWelcomeEmail } from './mobile-welcome-email';
export {
  useCompleteOnboardingMutation,
  useSetGroupMutation,
} from './mutations';
export {
  invalidateAllAfterLogin,
  invalidateUserInfo,
  type UserInfoData,
  updateUserInfo,
  useUserInfoQuery,
} from './user-info';
export {
  invalidateUserQuota,
  useInvalidateUserQuota,
  useUpdateUserQuotaCache,
  useUserQuotaQuery,
} from './user-quota';
