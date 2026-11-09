import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputData, JSONSchemaInput, quicktype } from 'quicktype-core';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(plugin, '../../../..');
const schema = await readFile(
  resolve(plugin, 'schema/bridge.schema.json'),
  'utf8'
);
const check = process.argv.includes('--check');
const header = '// Generated from schema/bridge.schema.json; do not edit.\n';

async function format(command: string[], source: string, cwd = repository) {
  const child = Bun.spawn(command, {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  await child.stdin.write(source);
  await child.stdin.end();
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error('Bridge formatting failed');
  return output;
}

for (const target of [
  {
    language: 'rust',
    path: resolve(plugin, 'src/generated.rs'),
    options: {
      visibility: 'public',
      'derive-debug': 'true',
      'derive-clone': 'true',
    },
  },
  {
    language: 'kotlin',
    path: resolve(
      plugin,
      'android/src/main/java/com/macro/editor/bridge/BridgeTypes.kt'
    ),
    options: { framework: 'jackson', package: 'com.macro.editor.bridge' },
  },
  {
    language: 'typescript',
    path: resolve(
      repository,
      'apps/web/src/lib/core/document-session/generated/native-bridge.ts'
    ),
    options: { 'just-types': 'true', 'prefer-unions': 'true' },
  },
]) {
  const input = new JSONSchemaInput(undefined);
  await input.addSource({ name: 'NativeBridgeTypes', schema });
  const inputData = new InputData();
  inputData.addInput(input);
  const result = await quicktype({
    inputData,
    lang: target.language,
    rendererOptions: target.options,
  });
  let output = header + result.lines.join('\n') + '\n';
  if (target.language === 'rust')
    output = await format(
      ['rustfmt', '--edition', '2024', '--emit', 'stdout'],
      output
    );
  if (target.language === 'typescript')
    output = await format(
      [
        'bun',
        'x',
        '@biomejs/biome@2.5.6',
        'format',
        '--stdin-file-path',
        target.path,
      ],
      output,
      resolve(repository, 'apps/web')
    );
  if (check) {
    if ((await readFile(target.path, 'utf8')) !== output)
      throw new Error(`Stale native bridge types: ${target.path}`);
  } else {
    await mkdir(dirname(target.path), { recursive: true });
    await Bun.write(target.path, output);
  }
}
