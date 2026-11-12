/** Verify the published tarball in consumers with only their chosen RTC runtime. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const sdk = resolve(import.meta.dir, '..');
const manifest = await Bun.file(join(sdk, 'package.json')).json();
const temporary = await mkdtemp(join(tmpdir(), 'macro-sdk-pack-'));

async function run(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, `${command.join(' ')} failed:\n${stdout}\n${stderr}`);
  return stdout;
}

try {
  const [report] = JSON.parse(
    await run(
      [
        'npm',
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        temporary,
      ],
      sdk,
    ),
  );
  const files = new Set<string>(
    report.files.map((file: { path: string }) => file.path),
  );
  for (const entry of Object.values<{ types: string; import: string }>(
    manifest.exports,
  )) {
    for (const target of [entry.types, entry.import]) {
      const path = target.replace(/^\.\//, '');
      if (path.includes('*')) {
        const [prefix, suffix] = path.split('*');
        assert(
          [...files].some(
            (file) => file.startsWith(prefix) && file.endsWith(suffix),
          ),
          `No packed files match ${target}`,
        );
      } else {
        assert(files.has(path), `Missing packed export ${target}`);
      }
    }
  }
  assert.deepEqual(
    [...files].filter(
      (file) =>
        !file.startsWith('dist/') &&
        !['package.json', 'README.md', 'CALLS.md', 'LICENSE.txt'].includes(
          file,
        ),
    ),
    [],
    'Unexpected files in tarball',
  );

  for (const runtime of ['core', 'browser', 'node']) {
    const consumer = join(temporary, runtime);
    await mkdir(consumer);
    await Bun.write(
      join(consumer, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
    );
    const packages = [join(temporary, report.filename)];
    const peer = runtime === 'node' ? '@livekit/rtc-node' : 'livekit-client';
    if (runtime !== 'core') {
      const installed = await Bun.file(
        join(sdk, 'node_modules', peer, 'package.json'),
      ).json();
      packages.push(`${peer}@${installed.version}`);
    }
    await run(
      [
        'npm',
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        ...packages,
      ],
      consumer,
    );
    for (const [name, wanted] of [
      ['@livekit/rtc-node', runtime === 'node'],
      ['livekit-client', runtime === 'browser'],
    ] as const) {
      assert.equal(
        await Bun.file(
          join(consumer, 'node_modules', name, 'package.json'),
        ).exists(),
        wanted,
        `${runtime} consumer has the wrong runtime dependencies: ${name}`,
      );
    }

    const source =
      runtime === 'core'
        ? "import { Macro } from '@macro-inc/sdk'; console.log(Macro);"
        : `import { connectRoom, publishScreen } from '@macro-inc/sdk/calls/${runtime}';
           console.log(connectRoom, publishScreen);`;
    await run(['node', '--input-type=module', '-e', source], consumer);
    const types = join(consumer, 'consumer.ts');
    await Bun.write(
      types,
      runtime === 'core'
        ? source
        : `${source}
      import type { CallRecord } from '@macro-inc/sdk';
      export const join = async (call: CallRecord) => {
        const { room } = await connectRoom(call);
        // @ts-expect-error Room must retain the selected runtime's types.
        room.notARoomMethod();
        return room;
      };`,
    );
    await run(
      [
        process.execPath,
        join(sdk, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        // Match the SDK's compiler settings for third-party RTC declarations.
        // Core stays fully checked without either peer present.
        ...(runtime === 'core' ? [] : ['--skipLibCheck']),
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'bundler',
        types,
      ],
      consumer,
    );

    if (runtime !== 'node') {
      const bundle = await build({
        stdin: { contents: source, resolveDir: consumer },
        bundle: true,
        // The core SDK already uses Node builtins for local authentication.
        platform: runtime === 'core' ? 'node' : 'browser',
        format: 'esm',
        write: false,
        metafile: true,
      });
      const inputs = Object.keys(bundle.metafile.inputs);
      assert(!inputs.some((file) => file.includes('@livekit/rtc-node')));
      if (runtime === 'core') {
        assert(
          !inputs.some((file) => /livekit|\/calls\/|opentelemetry/.test(file)),
          'Core bundle includes call media code',
        );
      } else {
        assert(inputs.some((file) => file.includes('livekit-client')));
        // Walk static output imports: a dynamic calls import must leave RTC
        // code outside the chunks loaded by the initial entry point.
        const lazy = await build({
          stdin: {
            contents: `export const connect = () => import('@macro-inc/sdk/calls/browser');`,
            resolveDir: consumer,
          },
          bundle: true,
          platform: 'browser',
          format: 'esm',
          splitting: true,
          outdir: join(consumer, 'bundle'),
          write: false,
          metafile: true,
        });
        const outputs = lazy.metafile.outputs;
        const entry = Object.keys(outputs).find(
          (file) => outputs[file].entryPoint === '<stdin>',
        );
        assert(entry, 'Missing dynamic-import consumer entry point');
        const pending = [entry];
        const visited = new Set<string>();
        while (pending.length) {
          const file = pending.pop();
          assert(file, 'Missing output path');
          if (visited.has(file)) continue;
          visited.add(file);
          const output = outputs[file];
          assert(output, `Missing output ${file}`);
          assert(
            !Object.keys(output.inputs).some((input) =>
              /livekit|\/calls\//.test(input),
            ),
            'Lazy calls code is included in an initial chunk',
          );
          for (const imported of output.imports) {
            if (!imported.external && imported.kind !== 'dynamic-import') {
              pending.push(imported.path);
            }
          }
        }
      }
    }
    console.log(
      `${runtime}: packed imports, types, and runtime isolation passed`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
