import path from 'node:path';
import type { Plugin } from 'vite';

/** Fail the build before an application dependency can enter the public site. */
export function standaloneBoundary(): Plugin {
  const website = path.resolve(import.meta.dirname, '..');
  const application = path.resolve(website, '../src');
  const workspacePackages = path.resolve(website, '../../../packages');
  return {
    name: 'standalone-website-boundary',
    enforce: 'pre',
    load(id) {
      const filename = id.split('?')[0];
      if (
        filename.startsWith(`${application}/`) ||
        filename.startsWith(`${workspacePackages}/`)
      ) {
        this.error(`The public website cannot import application code: ${id}`);
      }
      return null;
    },
  };
}
