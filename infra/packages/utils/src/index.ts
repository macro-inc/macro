import * as fs from 'fs';
import * as path from 'path';

/**
 * Returns whether the given folder path contains any items
 **/
export function hasItems(folderPath: string): boolean {
  const resolvedPath = path.resolve(folderPath);

  if (!fs.existsSync(resolvedPath)) {
    return false;
  }

  return fs.readdirSync(resolvedPath).length > 0;
}
