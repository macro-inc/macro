const POST_LOGIN_REDIRECT_KEY = 'redirectUrl';

/** Preserves a URL for BasePathComponent to restore after authentication. */
export function setPostLoginRedirect(url: string): void {
  sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, url);
}

/** Reads and clears the URL preserved by {@link setPostLoginRedirect}. */
export function consumePostLoginRedirect(): string | null {
  const url = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
  if (url !== null) {
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
  }
  return url;
}
