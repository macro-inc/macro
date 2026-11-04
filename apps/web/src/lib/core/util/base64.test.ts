import { describe, expect, it } from 'vitest';
import { decodeBase64Bytes, encodeBase64UrlUtf8 } from './base64';

it('encodes Unicode as unpadded URL-safe UTF-8 base64', () => {
  const text = 'Hi José 👋\nBring <notes> & coffee';
  const encoded = encodeBase64UrlUtf8(text);
  expect(encoded).not.toMatch(/[+/=]/);
  expect(new TextDecoder().decode(decodeBase64Bytes(encoded))).toBe(text);
  expect(encoded).toBe(
    btoa(unescape(encodeURIComponent(text)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  );
});

describe('decodeBase64Bytes', () => {
  it('decodes standard base64', () => {
    expect(decodeBase64Bytes('AAEC/w==')).toEqual(
      new Uint8Array([0, 1, 2, 255])
    );
  });

  it('decodes unpadded URL-safe base64', () => {
    expect(decodeBase64Bytes('-_8')).toEqual(new Uint8Array([251, 255]));
  });
});
