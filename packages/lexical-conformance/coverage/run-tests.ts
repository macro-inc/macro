import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { directory, files, hash, inputs, root } from './evidence';
import { build, seeds } from './matrix';

const regressionRoot = path.join(root, 'crates/client/lexical');
const regressionFiles = () =>
  files(regressionRoot).filter(
    (file) => file.includes('/proptest-regressions/') && file.endsWith('.txt')
  );
const regressionInputs = new Map(
  regressionFiles().map((file) => [file, readFileSync(file)])
);
function saveRegressions() {
  for (const file of regressionFiles()) {
    const before = regressionInputs.get(file);
    const after = readFileSync(file);
    if (before?.equals(after)) continue;
    const artifact = path.join(
      directory,
      'results/proptest',
      path.relative(root, file)
    );
    mkdirSync(path.dirname(artifact), { recursive: true });
    writeFileSync(artifact, after);
    if (before) {
      if (!after.subarray(0, before.length).equals(before))
        throw new Error('Regression inputs changed during execution');
      writeFileSync(file, before);
    } else rmSync(file);
  }
}
const fingerprint = inputs();
const output = path.join(directory, 'results/tests.json');
rmSync(output, { force: true });
const candidates = [
  ...new Map(
    build(seeds(readFileSync(path.join(directory, 'seed-matrix.tsv'), 'utf8')))
      .flatMap((row) => row.tests)
      .map((tag) => [tag.file + ':' + tag.line, tag])
  ).values(),
];
const tests = [];
let failed = false;
for (const pkg of [
  'lexical_model',
  'lexical_rich_nodes',
  'lexical_markdown',
  'lexical_conformance',
]) {
  const result = spawnSync('cargo', ['test', '-p', pkg, '--lib', '-j4'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  saveRegressions();
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  failed ||= result.status !== 0;
  const passed = [...result.stdout.matchAll(/^test (\S+) \.\.\. ok$/gm)].map(
    (match) => match[1]
  );
  for (const tag of candidates) {
    if (
      tag.ignored ||
      !tag.test ||
      !tag.file.startsWith(`crates/client/lexical/${pkg}/`)
    )
      continue;
    const sourcePrefix = `crates/client/lexical/${pkg}/src/`;
    if (!tag.file.startsWith(sourcePrefix)) continue;
    const module = tag.file
      .slice(sourcePrefix.length)
      .replace(/\.rs$/, '')
      .replace(/(?:^|\/)(?:lib|mod)$/, '')
      .replaceAll('/', '::');
    if (!module || !passed.includes(module + '::' + tag.test)) continue;
    tests.push({
      ...tag,
      sourceHash: hash(readFileSync(path.join(root, tag.file))),
      passed: true,
    });
  }
}
if (fingerprint !== inputs())
  throw new Error('Test inputs changed during execution');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify({ inputs: fingerprint, tests }, null, 2) + '\n'
);
process.exitCode = failed ? 1 : 0;
