import { SERVER_HOSTS } from '@core/constant/servers';

const GOOGLE_GMAIL_IDP = 'google_gmail';
type IDPName = 'google_gmail';

const DEFAULT_RETURN_PATH = '/app';

type EmailAuthParams = {
  idpName?: IDPName;
  returnPath?: string;
};

function emailAuthUrl(params: EmailAuthParams) {
  const idpName = params.idpName ?? GOOGLE_GMAIL_IDP;
  const returnUrl = `${window.location.origin}${params.returnPath ?? DEFAULT_RETURN_PATH}`;

  return `${SERVER_HOSTS['auth-service']}/login/sso?idp_name=${idpName}&original_url=${returnUrl}`;
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
