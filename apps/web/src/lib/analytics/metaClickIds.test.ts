import { afterEach, describe, expect, it } from 'vitest';
import {
  appendMetaClickIds,
  metaClickHeaders,
  metaClickIds,
  rememberMetaClick,
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

  it('keeps the ad click from a landing url the pixel never saw', () => {
    rememberMetaClick('?fbclid=IwAR0abc_-1', 'dev.macro.com');
    expect(metaClickIds('macro.com').fbc).toBeUndefined();

    rememberMetaClick('?fbclid=%3Cscript%3E', 'macro.com');
    expect(metaClickIds('macro.com').fbc).toBeUndefined();

    rememberMetaClick('?utm_source=meta&fbclid=IwAR0abc_-1', 'macro.com');
    const stored = metaClickIds('macro.com').fbc;
    expect(stored).toMatch(/^fb\.1\.\d+\.IwAR0abc_-1$/);

    document.cookie = '_fbc=fb.1.111.IwAR0abc_-1';
    rememberMetaClick('?fbclid=IwAR0abc_-1', 'macro.com');
    expect(metaClickIds('macro.com').fbc).toBe('fb.1.111.IwAR0abc_-1');

    rememberMetaClick('?fbclid=IwAR9new', 'macro.com');
    expect(metaClickIds('macro.com').fbc).toMatch(/^fb\.1\.\d+\.IwAR9new$/);
  });
});
