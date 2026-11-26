import { isAbsolute } from 'node:path';
import type { Plugin } from 'vite';
import { checkFile } from './boundary.ts';

export function botsBoundary(includeFixtures: boolean): Plugin {
  return {
    name: 'bots-workspace-boundary',
    enforce: 'pre',
    load(id) {
      const filename = id.split('?')[0];
      if (isAbsolute(filename)) {
        try {
          checkFile(filename);
        } catch (error) {
          this.error(String(error));
        }
      }
      return null;
    },
    generateBundle(_, bundle) {
      if (includeFixtures) return;

      for (const output of Object.values(bundle)) {
        if (
          output.type === 'chunk' &&
          Object.keys(output.modules).some((id) =>
            /\/(?:fleet|hire|brain|brain-email)-fixture\.ts$/.test(id)
          )
        ) {
          this.error('The default Bots build cannot include local fixtures');
        }
      }
    },
  };
}
