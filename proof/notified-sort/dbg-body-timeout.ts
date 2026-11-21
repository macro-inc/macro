// How Chromium reports a fetch whose AbortSignal.timeout fires, before the
// response headers and while the body is still arriving. Main's REST Soup
// read (createSoupRequestSignal, a 12 s AbortSignal.timeout) reports the first
// as "TimeoutError: signal timed out"; this shows what the second looks like.
// A local server answers /headers-late after 3 s and /body-late with headers at
// once and the body after 3 s; each read times out after 1 s.
import { createServer } from 'node:http';
import { launchBrowser } from './lib/browser.ts';

const server = createServer((req, res) => {
  if (req.url === '/') return res.end('<!doctype html><title>t</title>');
  const late = (fn: () => void) => setTimeout(fn, 3000);
  if (req.url === '/headers-late') return late(() => res.end('{"ok":true}'));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.flushHeaders();
  res.write('{"ok":');
  late(() => res.end('true}'));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  for (const [path, how] of [
    ['/headers-late', 'timeout'],
    ['/body-late', 'timeout'],
    ['/body-late', 'abort'],
  ] as const) {
    const result = await page.evaluate(
      async ({ path, how }) => {
        const controller = new AbortController();
        const signal = how === 'timeout' ? AbortSignal.timeout(1000) : controller.signal;
        if (how === 'abort') setTimeout(() => controller.abort(), 1000);
        try {
          const response = await fetch(path, { signal });
          await response.json();
          return 'answered';
        } catch (error) {
          return `${(error as Error).name}: ${(error as Error).message}`;
        }
      },
      { path, how }
    );
    console.log(`${path} ${how}: ${result}`);
  }
} finally {
  await browser.close();
  server.close();
}
