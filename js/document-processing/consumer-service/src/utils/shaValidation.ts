import { createHash } from 'crypto';

/**
 * @description Validates the sha of a file buffer
 */
export function validateSha(fileBuffer: Buffer, expectedSha: string): boolean {
  const hash = createHash('sha256');
  hash.update(fileBuffer);
  const calculatedSha = hash.digest('hex');
  return calculatedSha === expectedSha;
}

/**
 * @description Calculates the sha of a file buffer
 */
export function calculateSha(fileBuffer: Buffer): string {
  const hash = createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}
