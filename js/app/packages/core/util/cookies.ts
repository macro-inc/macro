export const LOGIN_COOKIE_AGE = 2592000; // 1 month in seconds

export type CookieOptions = {
  expires?: Date;
  maxAge?: number;
  path?: string;
  sameSite?: string;
};

export type LoginCookieOptions = {
  value: 'true' | 'false';
  expires: Date;
  maxAge: number;
  path: '/';
  sameSite: 'Lax';
};

/** Check if the user appears to be authenticated based on the login cookie. */
export function hasLoginCookie(): boolean {
  if (typeof document === 'undefined') return false;
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'login' && value === 'true') {
      return true;
    }
  }
  return false;
}

/** Compute login cookie options from auth state. */
export function getLoginCookieOptions(
  isAuthenticated: boolean
): LoginCookieOptions {
  if (isAuthenticated) {
    const expires = new Date();
    expires.setMonth(expires.getMonth() + 1);
    return {
      value: 'true',
      expires,
      maxAge: LOGIN_COOKIE_AGE,
      path: '/',
      sameSite: 'Lax',
    };
  }
  return {
    value: 'false',
    expires: new Date(0),
    maxAge: 0,
    path: '/',
    sameSite: 'Lax',
  };
}

export function updateCookie(
  name: string,
  value: string,
  options: CookieOptions
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
