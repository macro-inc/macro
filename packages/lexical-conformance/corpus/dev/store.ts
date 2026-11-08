import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// This is deliberately not configurable: real documents must never enter a checkout.
export const directory = '/home/wolf/tmp/lexical-port/corpus';

export function openCache() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory)
    throw new Error('Unsafe corpus directory');
  chmodSync(directory, 0o700);
  const keyPath = join(directory, 'key');
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Invalid corpus key');
  chmodSync(keyPath, 0o600);
  return {
    write(name: string, value: unknown) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
      writeFileSync(
        join(directory, name),
        Buffer.concat([iv, cipher.getAuthTag(), data]),
        { mode: 0o600, flag: 'wx' }
      );
    },
    read(name: string): unknown {
      const data = readFileSync(join(directory, name));
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          cipher.update(data.subarray(28)),
          cipher.final(),
        ]).toString()
      );
    },
  };
}
