import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const [bookPath, outputPath, targetArgument = '10000'] = process.argv.slice(2);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const target = Number(targetArgument);
if (
  !bookPath ||
  !outputPath ||
  !executablePath ||
  !Number.isSafeInteger(target) ||
  target < 1
)
  throw new Error(
    'Set a stock PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH and pass book.html output.html [HTML-block-target]'
  );
const book = await readFile(bookPath, 'utf8');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  const fixture = await page.evaluate(
    ({ book, target }) => {
      const doc = new DOMParser().parseFromString(book, 'text/html');
      doc.querySelectorAll('script,style,link').forEach((e) => e.remove());
      let blocks = doc.querySelectorAll(
        'p,h1,h2,h3,h4,h5,h6,pre,ul,ol,table,blockquote'
      ).length;
      const bookBlocks = blocks;
      let group = 0;
      while (blocks < target) {
        const i = group++;
        const section = document.createElement('div');
        section.innerHTML = `<h2>Mixed section ${i}</h2><p>Deterministic paragraph ${i}: selection and scrolling remain stable.</p><ul><li>First item ${i}</li><li>Second item ${i}</li></ul><ul __lexicallisttype="check"><li aria-checked="false">Pending ${i}</li><li aria-checked="true">Complete ${i}</li></ul><table><tbody><tr><td><p>Column A ${i}</p></td><td><p>Column B ${i}</p></td></tr><tr><td><p>Value ${i}</p></td><td><p>Value ${i + 1}</p></td></tr></tbody></table><pre><code class="language-javascript">const value${i} = ${i};\nconsole.log(value${i});</code></pre><p><img width="32" height="32" alt="Synthetic fixture image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23666'/%3E%3C/svg%3E"></p><p><span data-user-mention="true" data-user-id="00000000-0000-4000-8000-000000000001">Fixture mention</span> with surrounding text ${i}.</p>`;
        blocks += section.querySelectorAll('p,h2,pre,ul,table').length;
        doc.body.append(section);
      }
      return {
        html: doc.body.innerHTML,
        text: doc.body.textContent,
        blocks,
        bookBlocks,
        groups: group,
      };
    },
    { book, target }
  );
  await writeFile(outputPath, fixture.html);
  const metadata = {
    input: resolve(bookPath),
    inputSha256: createHash('sha256').update(book).digest('hex'),
    htmlSha256: createHash('sha256').update(fixture.html).digest('hex'),
    htmlBytes: Buffer.byteLength(fixture.html),
    htmlBlockCandidates: fixture.blocks,
    bookBlockCandidates: fixture.bookBlocks,
    mixedGroups: fixture.groups,
    browser: browser.version(),
    executablePath,
    qualification:
      'HTML candidates only; verify actual model, decorator and DOM counts after paste',
  };
  await writeFile(
    outputPath + '.json',
    JSON.stringify(metadata, null, 2) + '\n'
  );
  process.stdout.write(JSON.stringify(metadata, null, 2) + '\n');
} finally {
  await browser.close();
}
