import { readdirSync } from 'node:fs';
import { pull } from './pull';
import { object, scan } from './scan';
import { directory, openCache } from './store';

export function load() {
  const cache = openCache();
  return readdirSync(directory)
    .filter((name) => /^[0-9a-f]{64}\.enc$/.test(name))
    .sort()
    .flatMap((name) => {
      const value = cache.read(name);
      if (
        !object(value) ||
        typeof value.id !== 'string' ||
        typeof value.source !== 'string' ||
        typeof value.raw !== 'string' ||
        !Array.isArray(value.documents)
      )
        throw new Error('Invalid corpus record');
      return value.documents.map((state: unknown, index: number) => ({
        id: `${value.source}:${value.id}:${index}`,
        state,
        raw: JSON.stringify(state),
      }));
    });
}

export function scans() {
  const records = load();
  const result = {
    documents: records.length,
    documentsWithLoneSurrogates: 0,
    loneSurrogates: 0,
    magicChip: { nodes: 0, missing: 0, null: 0, known: 0, other: 0 },
    replyTarget: {
      nodes: 0,
      missing: 0,
      invalid: 0,
      type: 0,
      id: 0,
      extraKeys: 0,
      parentsWithExtraKeys: 0,
    },
  };
  for (const record of records) {
    const counts = scan(record.raw);
    result.loneSurrogates += counts.loneSurrogates;
    if (counts.loneSurrogates) result.documentsWithLoneSurrogates++;
    for (const key of Object.keys(
      result.magicChip
    ) as (keyof typeof result.magicChip)[])
      result.magicChip[key] += counts.magicChip[key];
    for (const key of Object.keys(
      result.replyTarget
    ) as (keyof typeof result.replyTarget)[])
      result.replyTarget[key] += counts.replyTarget[key];
  }
  return result;
}

if (import.meta.main) {
  try {
    if (process.argv[2] === 'pull') console.log(JSON.stringify(await pull()));
    else if (process.argv[2] === 'scan') console.log(JSON.stringify(scans()));
    else throw new Error('Expected pull or scan');
  } catch {
    console.error(
      'Corpus command failed; details suppressed to protect dev data. Check dev Doppler credentials, connectivity and cache permissions.'
    );
    process.exitCode = 1;
  }
}
