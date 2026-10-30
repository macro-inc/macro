import { fireAndForget } from '@core/util/fireAndForget';
import { authServiceClient } from '@service-auth/client';
import { invalidateUserInfo } from './user-info';
import { invalidateOwnUserName } from './user-name-self';

export const updateProfilePicture: typeof authServiceClient.putProfilePicture =
  (...args) => authServiceClient.putProfilePicture(...args);

export const updateUserName: typeof authServiceClient.putUserName = async (
  ...args
) => {
  const result = await authServiceClient.putUserName(...args);
  if (result.isOk()) fireAndForget(invalidateOwnUserName(), 'account-settings');
  return result;
};

export const deleteAccount: typeof authServiceClient.deleteUser = (...args) =>
  authServiceClient.deleteUser(...args);

export const redeemSessionCode: typeof authServiceClient.sessionLogin = (
  ...args
) => authServiceClient.sessionLogin(...args);

export const sendReferralInvite: typeof authServiceClient.sendReferralInvite = (
  ...args
) => authServiceClient.sendReferralInvite(...args);

export const endAuthSession: typeof authServiceClient.logout = (...args) =>
  authServiceClient.logout(...args);

export const updateAiDataConsent: typeof authServiceClient.patchAiConsent =
  async (...args) => {
    const result = await authServiceClient.patchAiConsent(...args);
    await invalidateUserInfo();
    return result;
  };
