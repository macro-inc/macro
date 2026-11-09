/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('empty inline links do not gain a placeholder line break', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'link', version: 1, url: '', children: [] }],
            },
            { type: 'paragraph', version: 1, children: [] },
          ],
        },
      })
    );
    expect(fixture.root.querySelector('a')).not.toBeNull();
    expect(fixture.root.querySelector('a > br')).toBeNull();
    expect(fixture.root.querySelectorAll('p:nth-child(2) > br')).toHaveLength(
      1
    );
  } finally {
    fixture.close();
  }
});
