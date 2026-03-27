import { ROUTER_BASE } from '@app/constants/routerBase';
import { SERVER_HOSTS } from '@core/constant/servers';

export const GOOGLE_GMAIL_IDP = 'google_gmail';
type IDPName = 'google_gmail';

type EmailAuthParams = {
  idpName?: IDPName;
  returnPath?: string;
};

function emailAuthUrl(params: EmailAuthParams) {
  const idpName = params.idpName ?? GOOGLE_GMAIL_IDP;
  const returnUrl = `${window.location.origin}${params.returnPath ?? ROUTER_BASE}`;

  const url = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
  url.searchParams.set('idp_name', idpName);
  url.searchParams.set('original_url', returnUrl);
  const referral_code = new URL(window.location.href).searchParams.get(
    'referral_code'
  );
  if (referral_code) url.searchParams.set('referral_code', referral_code);
  return url.toString();
}

export function redirectToEmailAuth(params: EmailAuthParams) {
  window.location.href = emailAuthUrl(params);
}

const POPUP_DIMENSIONS = {
  width: 600,
  height: 600,
  left: window.screenX + (window.outerWidth - 600) / 2,
  top: window.screenY + (window.outerHeight - 600) / 2,
};

function toPopupDimensionsString(dimensions: typeof POPUP_DIMENSIONS) {
  return `width=${dimensions.width},height=${dimensions.height},left=${dimensions.left},top=${dimensions.top}`;
}

export function openEmailAuthPopup(params: EmailAuthParams) {
  const ssoUrl = emailAuthUrl(params);

  window.open(ssoUrl, '_blank', toPopupDimensionsString(POPUP_DIMENSIONS));
}
