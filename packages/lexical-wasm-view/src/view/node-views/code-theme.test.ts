/** @vitest-environment jsdom */
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test.each(['code', 'custom-code'])(
  'real native %s uses the code theme rather than its serialized type name',
  (type) => {
    const fixture = nativeSurface(Access.Edit, { code: 'block code-surface' });
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type,
                version: 1,
                language: 'javascript',
                children: [
                  {
                    type: 'text',
                    version: 1,
                    text: 'const value = 1;',
                  },
                ],
              },
            ],
          },
        })
      );
      const code = fixture.root.querySelector('code');
      expect(code?.className).toBe('block code-surface');
      expect(code?.textContent).toBe('const value = 1;');
    } finally {
      fixture.close();
    }
  }
);
