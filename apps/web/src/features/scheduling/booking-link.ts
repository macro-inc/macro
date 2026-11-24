import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import { getWebOrigin } from '@core/util/webOrigin';
import type { SchedulingProfile } from './core/types';

export function schedulingLink(
  profile: Pick<SchedulingProfile, 'id'>,
  slug?: string
) {
  return `${getWebOrigin()}/app/book/${encodeURIComponent(profile.id)}${slug ? `/${encodeURIComponent(slug)}` : ''}`;
}

export async function copyBookingLink(
  profile: Pick<SchedulingProfile, 'id'>,
  slug?: string
) {
  const copied = await writeClipboardData({
    'text/plain': schedulingLink(profile, slug),
  });
  if (copied) toast.success(t('calendar.bookingLinkCopied'));
  else toast.failure(t('calendar.bookingLinkCopyError'));
  return copied;
}
