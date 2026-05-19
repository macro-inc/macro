// Re-export user context hooks for backwards compatibility
export {
  useAuthor,
  useEmail,



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


} from './mutations';
export {
  invalidateAllAfterLogin,
  invalidateUserInfo,
  type UserInfoData,

  useUserInfoQuery,
} from './user-info';
export {
  invalidateUserQuota,



} from './user-quota';
