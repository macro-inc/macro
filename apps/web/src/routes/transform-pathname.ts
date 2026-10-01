import { transformShortIdInUrlPathname } from '@core/util/url';
import { channelInviteRedirect } from '../features/channel-invitations/core/invite-code';

/** Invitation capabilities must not be reinterpreted as entity short IDs. */
export function transformAppPathname(pathname: string): string {
  return channelInviteRedirect(pathname)
    ? pathname
    : transformShortIdInUrlPathname(pathname);
}
