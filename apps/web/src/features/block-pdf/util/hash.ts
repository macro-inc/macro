import { Sha256 } from '@aws-crypto/sha256-js';
import { contentHash, toHex } from '@core/util/hash';

const UTF8Encoder = new TextEncoder();
export const hashString = (message: string) => {
  return contentHash(UTF8Encoder.encode(message));
};

/** this should only be used for beforeUnload cases because promises will not resolve on unload */
export const hashStringSync = (message: string) => {
  const hash = new Sha256();
  hash.update(message);
  return toHex(hash.digestSync());
};

export const getMapHash = async (map: Map<any, any>) => {
  const sortedEntries = Array.from(map.entries()).sort();
  const jsonString = JSON.stringify(sortedEntries);
  return hashString(jsonString);
};
