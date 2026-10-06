import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';

/** A form's respond link: `/form/<id>/respond`. */
function isFormRespondPath(pathname: string) {
  return /^\/form\/[^/]+\/respond\/?$/.test(
    pathname.slice(ROUTER_BASE_CONCAT.length - 1)
  );
}

/**
 * Whether a page renders in the focused shell, without the app's chrome:
 * booking links always; a form's respond link only for anonymous visitors,
 * so a public form never hits login while signed-in respondents keep the
 * app shell around the same page (RFC 02 §4). While sign-in is unknown the
 * focused shell shows.
 */
export function usesFocusedShell(
  pathname: string,
  authenticated: boolean | undefined
) {
  if (
    pathname.startsWith(`${ROUTER_BASE_CONCAT}book/`) ||
    pathname.startsWith(`${ROUTER_BASE_CONCAT}booking/`)
  )
    return true;
  return isFormRespondPath(pathname) && authenticated !== true;
}
