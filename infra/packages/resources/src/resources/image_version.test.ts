import { describe, expect, test } from 'bun:test';
import { imageVersion } from './image_version';

describe('imageVersion', () => {
  test('is the start of the image digest', () => {
    expect(
      imageVersion(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/email-service@sha256:1a2b3c4d5e6f77889900aabbccddeeff00112233445566778899aabbccddeeff'
      )
    ).toBe('1a2b3c4d5e6f');
  });

  test('rejects a URI without a digest', () => {
    expect(() =>
      imageVersion(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/email-service:latest'
      )
    ).toThrow();
  });
});
