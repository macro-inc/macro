import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const app = resolve(import.meta.dirname, '..');
const workspace = resolve(app, '../..');
const dependencies = resolve(workspace, 'node_modules');
const sdk = resolve(workspace, 'packages/sdk');

export const allowedWorkspacePackage = '@macro-inc/sdk';

function within(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function localFile(file: string): boolean {
  return within(app, file);
}

export function checkFile(file: string): void {
  const resolved = existsSync(file) ? realpathSync(file) : file;
  if ([app, dependencies, sdk].some((directory) => within(directory, resolved)))
    return;

  throw new Error(`Bots cannot load ${file}`);
}

export function checkUrl(specifier: string): void {
  if (
    specifier.startsWith('//') ||
    specifier.includes('\\') ||
    /^(?:[a-z][\w+.-]*:|\/(?:@fs|app|live-editor)(?:[/#?]|$))/i.test(specifier)
  ) {
    throw new Error(`Bots cannot load URL ${specifier}`);
  }
}
