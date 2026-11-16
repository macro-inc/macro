import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import typescript from 'typescript';
import { calling, execute } from '../../../core/code.ts';
import { checker, loader } from '../index.ts';

const config = join(import.meta.dir, '..', '..', '..', 'tsconfig.json');
const greeting = join(import.meta.dir, 'agent', 'greeting.ts');
const directory = await mkdtemp(join(import.meta.dir, '.scripts-'));
afterAll(() => rm(directory, { recursive: true }));

const check = checker({ typescript, config });

const written: string[] = [];
const load = loader({
  directory,
  script: { file: greeting, name: 'Script' },
  check: async (files) => check.check(files),
  id: () => crypto.randomUUID(),
  write: async (path, text) => {
    written.push(path);
    await Bun.write(path, text);
  },
  remove: (path) => rm(path, { force: true }),
  load: (path) => import(path),
});
const run = execute({ greeting: 'hello' }, load);

const imports = `
import type { Script } from ${JSON.stringify(greeting)};
import { greet } from ${JSON.stringify(greeting)};
`;

describe('checker', () => {
  test('finds nothing wrong with a file that type-checks, on disk or not', () => {
    expect(
      check.check({
        [join(directory, 'fine.ts')]: `${imports}
export const main = ({ context }: Script) => greet(context, "muppet");`,
      })
    ).toBeUndefined();
  });

  test('reports type errors with where they are', () => {
    const errors = check.check({
      [join(directory, 'wrong.ts')]: `${imports}
export const main = ({ context }: Script) => greet(context, 1);`,
    });
    expect(errors).toContain('wrong.ts(5,61): error TS2345');
    expect(errors).toContain(
      "'number' is not assignable to parameter of type 'string'"
    );
  });

  test('reports syntax errors', () => {
    expect(
      check.check({
        [join(directory, 'broken.ts')]: 'export const main = ( {',
      })
    ).toContain('error TS1005');
  });

  test("reads a module's functions from its code: docs, parameters as written, return type", () => {
    expect(check.signatures(greeting, ['greet', 'shout', 'greetings'])).toBe(
      [
        '/** Greets someone by name. */\ngreet({ greeting }: Context, name: string, punctuation?: string): Promise<string>',
        'shout(context: Context, { name }: { readonly name: string }): Promise<string>',
        '/** How many greetings there are. */\ngreetings: 1',
      ].join('\n\n')
    );
  });

  test('expands a parameter type derived from a value, which says nothing as written', () => {
    expect(check.signatures(greeting, ['greetDefault'])).toBe(
      '/** Greets the default someone, unless told otherwise. */\ngreetDefault(context: Context, input?: Partial<{ name: string; times: number; }>): Promise<string>'
    );
  });

  test("says which names a module doesn't export", () => {
    expect(check.signatures(greeting, ['nope'])).toBe(
      `nope: (not exported by ${greeting})`
    );
  });
});

describe('loader', () => {
  test("runs a script that type-checks, importing the agent's functions", async () => {
    expect(
      await run(`${imports}
export async function main({ context, log }: Script) {
	log("greeting");
	return await greet(context, "muppet");
}`)
    ).toEqual({
      kind: 'succeeded',
      output: 'hello, muppet!',
      logs: 'greeting',
    });
  });

  test("doesn't write or run a script that passes a function the wrong thing", async () => {
    const before = written.length;
    const executed = await run(`${imports}
export async function main({ context }: Script) {
	return await greet(context, { name: "muppet" });
}`);
    expect(executed.kind).toBe('failed');
    expect(executed.kind === 'failed' && executed.error).toContain(
      "the script doesn't type-check, so it wasn't run"
    );
    expect(executed.kind === 'failed' && executed.error).toContain('TS2345');
    expect(written.length).toBe(before);
  });

  test("rejects a script whose main expects something other than the agent's Script", async () => {
    const executed = await run(
      'export const main = ({ context }: { context: { missing: number } }) => context.missing;'
    );
    expect(executed.kind === 'failed' && executed.error).toContain(
      "is not assignable to type '(script: Script) => unknown'"
    );
  });

  test('rejects a script without main', async () => {
    const executed = await run('export const x = 1;');
    expect(executed.kind === 'failed' && executed.error).toContain(
      "has no exported member 'main'"
    );
  });

  test('rejects an untyped main, whose context would be anything', async () => {
    const executed = await run(
      'export async function main({ context }) { return context; }'
    );
    expect(executed.kind === 'failed' && executed.error).toContain('TS7031');
  });

  test('calls one function with JSON input, as a command line would', async () => {
    const script = { file: greeting, name: 'Script' };
    const greet = { file: greeting, name: 'greet' };
    expect(await run(calling(script, greet, 'muppet'))).toMatchObject({
      output: 'hello, muppet!',
    });
    expect(
      await run(
        calling(script, { file: greeting, name: 'shout' }, { name: 'x' })
      )
    ).toMatchObject({ output: 'hello, X!' });
    // A mistyped flag, or input a function doesn't take, never reaches it.
    expect((await run(calling(script, greet, { name: 'x' }))).kind).toBe(
      'failed'
    );
    expect((await run(calling(script, greet))).kind).toBe('failed');
    expect(
      (
        await run(
          calling(
            script,
            { file: greeting, name: 'shout' },
            { name: 'x', loud: true }
          )
        )
      ).kind
    ).toBe('failed');
  });

  test('leaves no script behind', async () => {
    await run(`${imports}
export const main = ({ context }: Script) => greet(context, "muppet");`);
    expect(await Array.fromAsync(new Bun.Glob('*').scan(directory))).toEqual(
      []
    );
  });

  test("checks a later script quickly, once the agent's code has been read", async () => {
    const started = performance.now();
    await run(`${imports}
export const main = ({ context }: Script) => greet(context, "again");`);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
