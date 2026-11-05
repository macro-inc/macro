import { assertEquals, assertStringIncludes } from '@std/assert';
import { readStyle } from './style.ts';

Deno.test('style reads nested guides in path order, skips the index, and reloads edits and additions', async () => {
  const root = await Deno.makeTempDir({ prefix: 'brain-style-' });
  try {
    await Deno.mkdir(`${root}/nested`);
    await Deno.writeTextFile(`${root}/z.md`, 'Last guide');
    await Deno.writeTextFile(`${root}/README.md`, 'Index only');
    await Deno.writeTextFile(`${root}/notes.txt`, 'Not a guide');
    await Deno.writeTextFile(`${root}/nested/a.md`, 'Nested guide');
    const first = await readStyle(root);
    assertStringIncludes(first, 'Nested guide\n\nLast guide');
    assertEquals(first.includes('Index only'), false);
    assertEquals(first.includes('Not a guide'), false);

    await Deno.writeTextFile(`${root}/nested/a.md`, 'Revised guide');
    await Deno.writeTextFile(`${root}/a.md`, 'New guide');
    assertStringIncludes(
      await readStyle(root),
      'New guide\n\nRevised guide\n\nLast guide'
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
