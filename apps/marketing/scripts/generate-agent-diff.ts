import { writeFile } from 'node:fs/promises';
import { preloadDiffHTML } from '@pierre/diffs/ssr';

const { DEPLOY_TRACE } = (await import(
  new URL(
    '../src/features/marketing/core/deploy-agent-demo.ts',
    import.meta.url
  ).href
)) as typeof import('../src/features/marketing/core/deploy-agent-demo');

// Freeze the same renderer output as the app without sending its highlighter,
// worker pool, or session code to visitors. Re-run when the fictional edit changes.
const edit = DEPLOY_TRACE.parts.find(
  (part) => part.kind === 'tool_use' && part.detail.kind === 'edit'
);
if (edit?.kind !== 'tool_use' || edit.detail.kind !== 'edit') {
  throw new Error('Sample deploy edit is missing');
}
const diff = edit.detail.diffs[0];
const html = await preloadDiffHTML({
  oldFile: { name: diff.path, contents: diff.oldText },
  newFile: { name: diff.path, contents: diff.newText },
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
    '../src/features/marketing/assets/deploy-retry-diff.html',
    import.meta.url
  ),
  html.replace(/[\t ]+$/gm, '')
);
