import { afterEach, beforeEach, test, vi } from 'vitest';
import type { Command } from './commands';
import { Comparison } from './compare';
import { RustCore } from './loader';
import { Upstream } from './upstream';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('formatting separate merge groups preserves the upstream element endpoint', async () => {
  const seed = JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [],
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
        },
        {
          type: 'paragraph',
          version: 1,
          children: [520, 40, 552, 544, 32].map((format) => ({
            type: 'text',
            version: 1,
            text: 'x',
            format,
            detail: 0,
            mode: 'normal',
            style: '',
          })),
          direction: null,
          format: '',
          indent: 0,
          textFormat: 520,
          textStyle: '',
        },
      ],
      direction: null,
      format: '',
      indent: 0,
    },
  });
  const commands: Command[] = [
    {
      kind: 'Select',
      anchor: { path: [1], offset: 4, type: 'element' },
      focus: { path: [0], offset: 0, type: 'element' },
    },
    { kind: 'FormatText', format: 'uppercase' },
  ];
  const upstream = new Upstream(seed);
  const native = new RustCore('upstream', seed);
  const comparison = new Comparison();
  try {
    comparison.compare(upstream.snapshot(), JSON.parse(native.snapshot()));
    for (const command of commands)
      comparison.compare(
        await upstream.apply(command),
        JSON.parse(native.apply(JSON.stringify(command), 0))
      );
  } finally {
    upstream.dispose();
    native.free();
  }
});
