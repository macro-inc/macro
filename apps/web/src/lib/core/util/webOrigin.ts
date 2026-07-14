import { isTauri } from './platform';

export function getWebOrigin(): string {
  if (isTauri()) {
    return import.meta.env.MODE === 'development'
      ? 'https://dev.macro.com'
      : 'https://macro.com';
  }
  return window.location.origin;
}
