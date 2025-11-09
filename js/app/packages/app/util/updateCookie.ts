export function updateCookie(
  name: string,
  value: string,
  options: { expires?: Date; maxAge?: number; path?: string; sameSite?: string }
) {
  let newCookie = `${name}=${value}`;

  if (options.expires) {
    newCookie += `; expires=${options.expires.toUTCString()}`;
  }
  if (typeof options.maxAge !== 'undefined') {
    newCookie += `; max-age=${options.maxAge}`;
  }
  if (options.path) {
    newCookie += `; path=${options.path}`;
  }
  if (options.sameSite) {
    newCookie += `; SameSite=${options.sameSite}`;
  }

  document.cookie = newCookie;
}
