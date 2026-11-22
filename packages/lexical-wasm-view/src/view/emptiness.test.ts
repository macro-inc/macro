/** @vitest-environment jsdom */
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test.each([8, 256])(
  'native maintained emptiness survives edits and undo among %i paragraphs',
  (size) => {
    const fixture = nativeSurface();
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: Array.from({ length: size }, () => ({
              type: 'paragraph',
              version: 1,
              children: [],
            })),
          },
        })
      );
      expect(fixture.view.isEmpty()).toBe(true);
      const last = fixture.view.node(0)?.children.at(-1);
      if (last === undefined) throw new Error('Missing native blank paragraph');
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: last, type: 'element', offset: 0 },
        focus: { key: last, type: 'element', offset: 0 },
      });
      fixture.port.command(CommandCode.InsertText, 0, 0, 'x');
      expect(fixture.view.isEmpty()).toBe(false);
      const lookups = vi.spyOn(fixture.view, 'node');
      try {
        for (let i = 0; i < 1000; i++)
          expect(fixture.view.isEmpty()).toBe(false);
        expect(lookups.mock.calls).toHaveLength(0);
      } finally {
        lookups.mockRestore();
      }
      fixture.port.command(CommandCode.Undo);
      expect(fixture.view.isEmpty()).toBe(true);
    } finally {
      fixture.close();
    }
  }
);
