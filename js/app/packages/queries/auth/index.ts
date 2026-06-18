// Re-export user context hooks for backwards compatibility
export {
  useIsAuthenticated,
  useUserId,
  useUserInfo,
} from '@core/context/user';
export {
  type GithubLink,
  type GithubLinkStatus,
  invalidateGithubLinkStatus,
  useDeleteGithubLinkMutation,
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from './github-link';
export { useInitGmailLink } from './gmail-link';
export { authKeys } from './keys';
export { useSendMobileWelcomeEmail } from './mobile-welcome-email';
export {} from './mutations';
export type { UserInfoData } from './user-info';
export {
  normalizeUserNameQueryId,
  userNameQueryOptions,
  useUserNamesQuery,
} from './user-names';
export { invalidateUserQuota } from './user-quota';
