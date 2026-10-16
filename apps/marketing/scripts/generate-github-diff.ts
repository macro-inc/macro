import { writeFile } from 'node:fs/promises';
import { preloadDiffHTML } from '@pierre/diffs/ssr';
import { signInFiles } from '../src/features/marketing/components/reviews/githubProject';

for (const [index, file] of signInFiles.entries()) {
  const html = await preloadDiffHTML({
    oldFile: { name: file.path, contents: file.oldText },
    newFile: { name: file.path, contents: file.newText },
    options: {
      diffStyle: 'unified',
      diffIndicators: 'bars',
      disableFileHeader: true,
      overflow: 'wrap',
      hunkSeparators: 'line-info-basic',
      lineDiffType: 'none',
      expansionLineCount: 20,
      themeType: 'dark',
    },
  });
  await writeFile(
    new URL(
      `../src/features/marketing/assets/github-signin-${index}.html`,
      import.meta.url
    ),
    html.replace(/[\t ]+$/gm, '')
  );
}
