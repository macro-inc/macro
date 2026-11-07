import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { files, root } from './evidence';

const bundleOnly = process.argv.includes('--bundle-only');
if (!bundleOnly) {
  const tree = spawnSync(
    'cargo',
    [
      'tree',
      '--workspace',
      '-i',
      'lexical_conformance_wasm',
      '-e',
      'normal',
      '--prefix',
      'none',
    ],
    { cwd: root, encoding: 'utf8' }
  );
  if (tree.status !== 0) throw new Error(tree.stderr);
  const dependents = tree.stdout
    .trim()
    .split('\n')
    .filter((line) => line && !line.startsWith('lexical_conformance'));
  if (dependents.length)
    throw new Error(
      'Conformance wasm has shipped dependents: ' + dependents.join(', ')
    );
  for (const file of ['apps', 'packages'].flatMap((name) =>
    files(path.join(root, name))
  )) {
    const name = path.relative(root, file);
    if (
      name.startsWith('packages/lexical-conformance/') ||
      name === 'packages/lexical-wasm-shim/src/backend/conformance.ts' ||
      /lexical-wasm-shim\/.*(test|setup)/.test(name)
    )
      continue;
    if (!/\.(tsx?|m?js)$/.test(name)) continue;
    if (
      /(?:from\s*|import\s*\(|require\s*\()["'][^"']*(?:lexical-conformance\/pkg|lexical_conformance_wasm)/.test(
        readFileSync(file, 'utf8')
      )
    )
      throw new Error('Shipped source imports development oracle: ' + name);
  }
  console.log('Conformance wasm dependency and source-import checks passed');
}
if (bundleOnly) {
  const bundle = path.join(root, 'apps/web/dist');
  if (!existsSync(bundle))
    throw new Error('Production bundle is required for the bundle gate');
  if (!files(bundle).some((file) => /\.(js|wasm)$/.test(file)))
    throw new Error('Production bundle contains no executable artifacts');
  for (const file of files(bundle).filter((name) => /\.(js|wasm)$/.test(name)))
    if (
      /lexical_conformance_wasm|(?:editorhandle|corehandle)_[a-zA-Z_0-9]+|\b(?:EditorHandle|CoreHandle)\b/.test(
        readFileSync(file).toString('latin1')
      )
    )
      throw new Error(
        'Production bundle includes oracle symbols: ' +
          path.relative(root, file)
      );
  console.log('Production bundle symbol scan passed');
}
