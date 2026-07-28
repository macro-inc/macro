export function setCookie(name: string, value: string, days: number) {
  const expires = days
    ? `; expires=${new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()}`
    : '';
  document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/`;
}

export enum Stage {
  Verify = 'verify',
  Email = 'email',
  Done = 'done',
  None = 'none',
}
