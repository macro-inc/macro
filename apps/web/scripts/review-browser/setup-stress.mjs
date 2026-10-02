import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Always create a fresh disposable repository; never modify a supplied checkout.
const directory = await mkdtemp(join(tmpdir(), 'macro-review-stress-'));
const git = (...args) => execFileSync('git', ['-C', directory, ...args]);
await mkdir(join(directory, 'src'));
const lines = Array.from(
  { length: 100_000 },
  (_, i) => `export const v${i} = ${i};`
);
await writeFile(join(directory, 'src/large.ts'), `${lines.join('\n')}\n`);
await writeFile(join(directory, 'src/wide.ts'), 'const before = 1;\n');
await writeFile(
  join(directory, 'src/deleted.rs'),
  'fn removed() {\n    println!("before");\n}\n'
);
git('init', '--quiet', '--initial-branch', 'main');
git('add', '.');
git(
  '-c',
  'user.name=Review browser lab',
  '-c',
  'user.email=review-lab@example.com',
  'commit',
  '--quiet',
  '-m',
  'Review stress base'
);
for (const i of [100, 50_000, 99_999])
  lines[i] = `export const v${i} = ${i + 1};`;
await writeFile(join(directory, 'src/large.ts'), `${lines.join('\n')}\n`);
await writeFile(
  join(directory, 'src/wide.ts'),
  `const after = 2;\n\t\t// ${'宽'.repeat(90)} HORIZONTAL_TAIL\nconst escaped = "<img src=x onerror=alert(1)>";\n`
);
await unlink(join(directory, 'src/deleted.rs'));
await writeFile(
  join(directory, 'image.png'),
  Buffer.from([137, 80, 78, 71, 0, 13, 10])
);
await writeFile(join(directory, 'empty.ts'), '');
await writeFile(
  join(directory, 'package-lock.json'),
  '{"lockfileVersion":3}\n'
);
console.log(directory);
