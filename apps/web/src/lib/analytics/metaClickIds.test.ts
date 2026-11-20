import { afterEach, describe, expect, it } from 'vitest';
import {
  appendMetaClickIds,
  metaClickHeaders,
  metaClickIds,
} from './metaClickIds';

afterEach(() => {
  document.cookie = '_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  document.cookie = '_fbc=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('meta click ids', () => {
  it('reads production pixel cookies and ignores other hosts', () => {
    document.cookie = '_fbp=fb.1.2.3';
    document.cookie = '_fbc=fb.1.4.Ab';
    expect(metaClickIds('dev.macro.com')).toEqual({});

    expect(metaClickIds('macro.com')).toEqual({
      fbp: 'fb.1.2.3',
      fbc: 'fb.1.4.Ab',
    });

    const url = new URL('https://gateway.macro.com/auth/login/sso');
    appendMetaClickIds(url, 'macro.com');
    expect(url.searchParams.get('fbp')).toBe('fb.1.2.3');
    expect(url.searchParams.get('fbc')).toBe('fb.1.4.Ab');
    expect(metaClickHeaders('macro.com')).toEqual({
      'X-Macro-Fbp': 'fb.1.2.3',
      'X-Macro-Fbc': 'fb.1.4.Ab',
    });
  });

  it('drops click ids that are not safe to forward', () => {
    document.cookie = '_fbp=fb.1.2.3%3Cscript%3E';
    expect(metaClickIds('www.macro.com').fbp).toBeUndefined();
  });
});
