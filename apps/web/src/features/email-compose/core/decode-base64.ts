import { decodeBase64Bytes } from '@core/util/base64';

export function decodeBase64Utf8(input: string): string {
  try {
    return new TextDecoder('utf-8').decode(decodeBase64Bytes(input));
  } catch {
    return input;
  }
}
