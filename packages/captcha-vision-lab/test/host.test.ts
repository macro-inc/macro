/**
 * The browser host's protocol: it answers only well-formed fixture
 * requests, and ends on anything else.
 */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { hostEnvironment } from '../src/browser-options.ts';

const HOST = join(import.meta.dir, '..', 'src', 'browser-host.ts');

/** Runs a host, writes the lines, and returns its exit code and output. */
const runHost = async (lines: string[]) => {
  const env = hostEnvironment();
  const host = Bun.spawn(
    [Bun.which('node', { PATH: env.PATH ?? '' }) ?? 'node', HOST],
    {
      env,
      stdin: 'pipe',
      stdout: 'pipe',
    }
  );
  for (const line of lines) host.stdin.write(`${line}\n`);
  await host.stdin.end();
  return {
    exitCode: await host.exited,
    output: await new Response(host.stdout).text(),
  };
};

test('a well-formed observe is answered', async () => {
  const { exitCode, output } = await runHost(['{"type":"observe"}']);

  expect(exitCode).toBe(0);
  expect(JSON.parse(output)).toEqual({
    type: 'observations',
    observations: {
      mainNavigations: 0,
      redirects: 0,
      popups: 0,
      extraFrames: 0,
      blockedOrigins: [],
      blockedNavigations: 0,
    },
  });
});

const refused: [string, string][] = [
  ['not JSON', 'click at 10,10'],
  ['an unknown message', '{"type":"evaluate","script":"1"}'],
  ['an extra field', '{"type":"observe","url":"http://example.invalid/"}'],
  ['coordinates', '{"type":"act","action":{"kind":"click","x":10,"y":10}}'],
  [
    'an open of any other URL',
    '{"type":"open","targetUrl":"http://127.0.0.1:47831/other","capability":"c","sessionNonce":"n","profile":"/tmp/x"}',
  ],
  ['a capture before open', '{"type":"capture"}'],
  [
    'an action before open',
    '{"type":"act","action":{"kind":"choose","label":"A"}}',
  ],
];

for (const [name, line] of refused) {
  test(`${name} ends the host without an answer`, async () => {
    const { exitCode, output } = await runHost([line, '{"type":"observe"}']);

    expect(exitCode).toBe(2);
    expect(output).toBe('');
  });
}
