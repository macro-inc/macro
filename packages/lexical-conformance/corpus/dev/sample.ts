import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { database } from './access';
import { object } from './scan';
import { directory, openCache } from './store';

export function validateSample(value: unknown): string[] {
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.ids) ||
    value.ids.length > 2000 ||
    value.ids.some((id) => typeof id !== 'string' || !id.length) ||
    new Set(value.ids).size !== value.ids.length
  )
    throw new Error('Invalid corpus sample');
  return value.ids;
}

/** Freeze once, resume the same bounded sample; old cached documents are not admitted. */
export function sampleIds(create = false): string[] {
  const cache = openCache();
  if (!existsSync(join(directory, 'sample.enc'))) {
    if (!create) throw new Error('Collect a frozen dev sample before scanning');
    const rows = database()(
      `SELECT json_build_object('id',id) FROM "Document" WHERE "fileType"='md' AND "deletedAt" IS NULL ORDER BY "updatedAt" DESC, id LIMIT 2000;`,
      ''
    );
    const ids = rows.map((row) => {
      if (!object(row) || typeof row.id !== 'string')
        throw new Error('Invalid dev inventory');
      return row.id;
    });
    cache.write('sample.enc', { version: 1, ids });
  }
  return validateSample(cache.read('sample.enc'));
}
