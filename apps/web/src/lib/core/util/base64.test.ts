import { describe, expect, it } from 'vitest';
import { decodeBase64Bytes } from './base64';

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
