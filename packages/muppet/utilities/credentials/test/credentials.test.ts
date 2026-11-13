import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCredentials, sopsCredentials } from '../index.ts';

describe('memoryCredentials', () => {
  test('gets, sets and lists, and refuses missing or empty ones', async () => {
    const credentials = memoryCredentials({ a: '1', empty: '' });
    expect(await credentials.get('a')).toBe('1');
    expect(credentials.get('empty')).rejects.toThrow(
      'no credential named empty'
    );
    expect(await credentials.has('b')).toBe(false);
    await credentials.set('b', '2');
    expect(await credentials.get('b')).toBe('2');
    expect(await credentials.names()).toEqual(['a', 'b', 'empty']);
  });
});

const tools = Bun.which('sops') !== null && Bun.which('age-keygen') !== null;

/** Runs a program in a test, returning its output. */
const sh = async (...argv: string[]): Promise<string> => {
  const child = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${argv[0]} exited ${code}`);
  return stdout;
};

/** An age key and a file of secrets encrypted to it, in a fresh directory. */
const encrypted = async (secrets: Record<string, string>) => {
  const directory = await mkdtemp(join(tmpdir(), 'muppet-sops-'));
  const key = join(directory, 'key.txt');
  const plain = join(directory, 'secrets.json');
  const file = join(directory, 'secrets.enc.json');
  await sh('age-keygen', '-o', key);
  const recipient = (await sh('age-keygen', '-y', key)).trim();
  await Bun.write(plain, JSON.stringify(secrets));
  await Bun.write(
    file,
    await sh(
      'sops',
      'encrypt',
      '--age',
      recipient,
      '--input-type',
      'json',
      '--output-type',
      'json',
      plain
    )
  );
  return {
    directory,
    key,
    file,
    [Symbol.asyncDispose]: () => rm(directory, { recursive: true }),
  };
};

describe.skipIf(!tools)('sopsCredentials', () => {
  test('reads and writes through real sops and age', async () => {
    await using secrets = await encrypted({ first: 'one' });
    expect(await Bun.file(secrets.file).text()).not.toContain('"one"');
    const credentials = sopsCredentials({
      file: secrets.file,
      env: { SOPS_AGE_KEY_FILE: secrets.key },
    });

    expect(await credentials.get('first')).toBe('one');
    await credentials.set('second', 'a "quoted" value');
    expect(await credentials.get('second')).toBe('a "quoted" value');
    expect(await credentials.names()).toEqual(['first', 'second']);
    expect(await Bun.file(secrets.file).text()).not.toContain('quoted');
    expect(credentials.get('third')).rejects.toThrow(
      'no credential named third'
    );
  });

  test("reports a file it can't decrypt", async () => {
    await using secrets = await encrypted({ first: 'one' });
    const wrongKey = join(secrets.directory, 'other.txt');
    await sh('age-keygen', '-o', wrongKey);

    const credentials = sopsCredentials({
      file: secrets.file,
      env: { SOPS_AGE_KEY_FILE: wrongKey },
    });
    expect(credentials.names()).rejects.toThrow('sops exited');
  });
});
