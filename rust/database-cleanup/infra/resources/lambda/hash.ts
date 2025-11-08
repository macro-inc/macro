import * as fs from 'fs';
import * as path from 'path';
import { createHash, Hash } from 'crypto';

const IGNORE_PATHS = [
  'node_modules',
  '.git',
  'target',
  'migrations',
  'fixtures',
  '.sqlx',
];

function processDirectory(hash: Hash, directoryPath: string) {
  // Read the directory contents and sort them to ensure consistency
  const items = fs.readdirSync(directoryPath);

  // Iterate over each item in the directory
  items.forEach((item) => {
    const itemPath = path.join(directoryPath, item);
    const stats = fs.statSync(itemPath);
    console.log('processing', itemPath);

    if (stats.isFile()) {
      // If the item is a file, read its content and update the hash
      const fileBuffer = fs.readFileSync(itemPath);
      // Include both the item name and its content in the hash
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
      hash.update(item + fileBuffer);
    } else if (stats.isDirectory()) {
      if (IGNORE_PATHS.filter((path) => itemPath.includes(path)).length > 0) {
        console.log('skipping', itemPath);
      } else {
        // If the item is a directory, recursively process it
        processDirectory(hash, itemPath);
      }
    }
  });
}

export function generateContentHash(directory: string): string {
  if (!fs.existsSync(directory)) {
    throw new Error(`Directory ${directory} does not exist`);
  }

  const hash = createHash('sha256');
  processDirectory(hash, directory);
  return hash.digest('base64');
}
