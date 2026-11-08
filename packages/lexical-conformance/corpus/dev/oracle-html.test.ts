import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('HTML oracle supplies DOM constructors and restores the absent host', () => {
  const script = `
    import { strict as assert } from 'node:assert';
    const { oracle } = await import(${JSON.stringify(new URL('./oracle.ts', import.meta.url).href)});
    const before = [globalThis.HTMLElement, globalThis.DocumentFragment, globalThis.Text, globalThis.Node, globalThis.window];
    const result = await oracle('html', {markdown: '| a | b |\\n| - | - |\\n| 1 | 2 |\\n'});
    assert.ok(result.ok?.html.includes('<table>'));
    assert.equal(result.ok.text, 'a\\n\\nb\\n\\n1\\n\\n2');
    assert.deepEqual([globalThis.HTMLElement, globalThis.DocumentFragment, globalThis.Text, globalThis.Node, globalThis.window], before);
  `;
  const result = spawnSync('bun', ['-e', script], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});
