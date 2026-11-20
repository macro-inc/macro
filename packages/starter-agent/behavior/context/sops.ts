import { z } from 'zod';
import type { Credentials } from './credentials.ts';
import { output, type Shell } from './shell.ts';

const Secrets = z.record(z.string(), z.string());

/**
 * Credentials in one JSON file encrypted with SOPS. The file is committed;
 * the age key that opens it is on the machine the agent runs on. It is decrypted
 * into memory once per process, and again after a `set`.
 */
export const sopsCredentials = ({
  file,
  sops,
  shell,
}: {
  /** The encrypted file. */
  readonly file: string;
  /** The sops program. */
  readonly sops: string;
  readonly shell: Pick<Shell, 'run'>;
}): Credentials => {
  const decrypt = async (): Promise<Readonly<Record<string, string>>> =>
    Secrets.parse(
      JSON.parse(
        await output(shell, [sops, 'decrypt', '--output-type', 'json', file])
      )
    );
  let secrets: Promise<Readonly<Record<string, string>>> | undefined;
  const all = () => {
    secrets ??= decrypt().catch((error: unknown) => {
      secrets = undefined;
      throw error;
    });
    return secrets;
  };
  return {
    get: async (name) => {
      const value = (await all())[name];
      if (value === undefined || value === '')
        throw new Error(`no credential named ${name} in ${file}`);
      return value;
    },
    has: async (name) => ((await all())[name] ?? '') !== '',
    set: async (name, value) => {
      // The value goes in on stdin, so it is never in a process's arguments.
      await output(
        shell,
        [sops, 'set', '--value-stdin', file, JSON.stringify([name])],
        { stdin: JSON.stringify(value) }
      );
      secrets = undefined;
    },
    names: async () => Object.keys(await all()).sort(),
  };
};
