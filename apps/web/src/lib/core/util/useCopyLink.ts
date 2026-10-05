import { toast } from '@core/component/Toast/Toast';
import { useReferralCode } from '@core/context/user';

export type CopyLinkOptions = {
  /** Extra toast detail shown under the confirmation. */
  subtext?: string;
  /** Skip the toast when the caller confirms the copy itself. */
  silent?: boolean;
};

/**
 * Returns a function that copies a link tagged with the user's referral code
 * and confirms it with a toast.
 */
export function useCopyLink() {
  const referralCode = useReferralCode();

  return async (link: string, options: CopyLinkOptions = {}) => {
    const url = new URL(link);
    const code = referralCode();
    if (code) url.searchParams.set('referral_code', code);
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      toast.failure('Could not copy link');
      return false;
    }
    if (!options.silent) {
      toast.success('Link copied to clipboard.', { subtext: options.subtext });
    }
    return true;
  };
}
