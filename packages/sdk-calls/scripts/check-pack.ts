/**
 * Fails unless the tarball npm would publish holds every file `exports` names
 * and nothing that shouldn't ship, and that each export loads in Node. Run after
 * `bun run build`.
 */
const manifest = await Bun.file('package.json').json();

const packed = Bun.spawnSync([
  'npm',
  'pack',
  '--dry-run',
  '--ignore-scripts',
  '--json',
]);
if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());

const [report] = JSON.parse(packed.stdout.toString());
const files = new Set<string>(
  report.files.map((file: { path: string }) => file.path)
);

const required = Object.values<{ types: string; import: string }>(
  manifest.exports
).flatMap((entry) => [entry.types, entry.import]);
for (const file of required) {
  if (!files.has(file.replace(/^\.\//, ''))) {
    throw new Error(`the package is missing ${file}`);
  }
}

const unexpected = [...files].filter(
  (file) =>
    !file.startsWith('dist/') &&
    !['package.json', 'README.md', 'LICENSE.txt'].includes(file)
);
if (unexpected.length > 0) {
  throw new Error(`the package would ship ${unexpected.join(', ')}`);
}

// A relative import without its extension compiles but fails in Node.
for (const entry of Object.values<{ import: string }>(manifest.exports)) {
  const load = Bun.spawnSync([
    'node',
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(entry.import)})`,
  ]);
  if (load.exitCode !== 0) {
    throw new Error(`${entry.import} fails to load: ${load.stderr.toString()}`);
  }
}

console.log(
  `${report.name}@${report.version}: ${files.size} files, exports ok`
);
