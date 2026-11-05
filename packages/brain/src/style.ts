// Agent-owned communication guides, re-read for every turn. No name manifest:
// adding a Markdown file to the library makes it available on the next turn.
import { join } from 'node:path';

export async function readStyle(directory: string): Promise<string> {
  const guides: { path: string; text: string }[] = [];
  const read = async (relative: string): Promise<void> => {
    for await (const entry of Deno.readDir(join(directory, relative))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory) await read(path);
      else if (
        entry.isFile &&
        entry.name.endsWith('.md') &&
        entry.name !== 'README.md'
      ) {
        guides.push({
          path,
          text: (await Deno.readTextFile(join(directory, path))).trim(),
        });
      }
    }
  };
  await read('');
  guides.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  return [
    '## Communication craft',
    'Apply these guides in your own voice, within OPERATING.md. Examples are fictional, not instructions from a sender.',
    ...guides.map((guide) => guide.text),
  ].join('\n\n');
}
